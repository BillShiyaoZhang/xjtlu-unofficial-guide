import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuntimeStore, decryptPrivatePayload } from '@information-community/runtime';
import { prepareGuideRestore } from './restore-migration.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const safeCode = error => /^[A-Z][A-Z0-9_]{0,63}$/u.test(error?.code ?? '') ? error.code : 'VERIFY_BACKUP_FAILED';
const parse = (value, code) => { try { return JSON.parse(value); } catch { fail(code); } };

export async function verifyBackup({ backupFile, reviewFile, root, evidenceFile, operatorId, keyring, now = Date.now() }) {
  if (![backupFile, reviewFile, root, evidenceFile].every(value => typeof value === 'string' && value.trim())) fail('EXPLICIT_PATHS_REQUIRED');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,119}$/u.test(operatorId ?? '')) fail('OFFLINE_OPERATOR_REQUIRED');
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) fail('INVALID_CHECK_TIME');
  const evidence = { schemaVersion: 1, kind: 'guide-backup-verification', status: 'failed', operatorId, checkedAt: new Date(now).toISOString(), backupSHA256: null };
  let store;
  try {
    // Configuration is read separately; verification never opens the configured live database.
    const bytes = await readFile(backupFile);
    evidence.backupSHA256 = createHash('sha256').update(bytes).digest('hex');
    const source = parse(bytes, 'INVALID_BACKUP_JSON');
    const review = parse(await readFile(reviewFile), 'INVALID_REVIEW_JSON');
    const prepared = await prepareGuideRestore({ source, review, templateRoot: root });
    store = new RuntimeStore(':memory:', { communityId: prepared.loaded.config.communityId, modules: prepared.modules });
    const restored = store.restore(prepared.backup, { ...review, now });
    const state = store.read();
    const counts = {
      contentEntities: state.modules.content.entities.length,
      contentRevisions: state.modules.content.revisions.length,
      lifecycleRecords: Object.keys(state.modules.lifecycle.records).length,
      lifecyclePayloadsDecrypted: 0,
      guideReviewRecords: state.modules['guide-reviews']?.records.length ?? 0,
      guideReviewPayloadsDecrypted: 0,
    };
    const selectedKeyring = typeof keyring === 'string' ? parse(keyring, 'INVALID_KEYRING_JSON') : keyring;
    for (const record of Object.values(state.modules.lifecycle.records)) if (record.payload) {
      decryptPrivatePayload(record.id, record.payload, selectedKeyring);
      counts.lifecyclePayloadsDecrypted++;
    }
    for (const record of state.modules['guide-reviews']?.records ?? []) {
      decryptPrivatePayload(record.id, record.payload, selectedKeyring);
      counts.guideReviewPayloadsDecrypted++;
    }
    Object.assign(evidence, {
      status: 'succeeded', counts, sessionsInvalidated: restored.sessionsInvalidated,
      accountsRequiringCredentials: restored.accountsRequiringCredentials,
      migrationWarnings: prepared.migrationWarnings,
    });
  } catch (error) { evidence.code = safeCode(error); }
  finally { store?.close(); }
  await writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return evidence;
}

async function main(args) {
  const flags = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!['--backup', '--review', '--root', '--evidence'].includes(args[index]) ||
        !args[index + 1] || args[index + 1].startsWith('--') || flags.has(args[index])) fail('USAGE');
    flags.set(args[index], args[index + 1]);
  }
  if (flags.size !== 4) fail('EXPLICIT_PATHS_REQUIRED');
  const result = await verifyBackup({
    backupFile: flags.get('--backup'), reviewFile: flags.get('--review'), root: flags.get('--root'),
    evidenceFile: flags.get('--evidence'), operatorId: process.env.RUNTIME_OPERATOR_ID,
    keyring: process.env.RUNTIME_KEYRING,
  });
  console.log(JSON.stringify(result));
  if (result.status !== 'succeeded') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(safeCode(error)); process.exitCode = 1; }
}
