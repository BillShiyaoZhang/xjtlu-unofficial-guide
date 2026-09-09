import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const platformRoot = process.env.PLATFORM_ROOT;
if (!platformRoot) throw new Error('Set PLATFORM_ROOT to the upstream repository checkout.');
const root = resolve(platformRoot);
const runtime = await import(pathToFileURL(join(root, 'packages/runtime/index.mjs')).href);
const profile = JSON.parse(await readFile(join(root, 'examples/runtime/content-profile.json'), 'utf8'));
const bundle = JSON.parse(await readFile(join(root, 'examples/runtime/content.json'), 'utf8'));
const now = Date.parse('2026-09-09T10:00:00Z');
const principal = { id: 'probe-reviewer', subjectId: 'probe-reviewer', mfa: true, roles: ['reviewer'] };
const options = {
  now,
  policy: { reviewer: ['lifecycle:manage', 'lifecycle:self'] },
  keyring: { activeVersion: 'v1', keys: { v1: '11'.repeat(32) } },
  config: {
    workflows: {
      report: {
        states: ['submitted', 'resolved'], initialState: 'submitted',
        transitions: { submitted: ['resolved'], resolved: [] },
        terminalStates: ['resolved'], decisionCodes: ['corrected'],
        publicResults: { corrected: { code: 'corrected', label: 'Reviewed correction' } },
        retentionMs: 86400000, requireConsent: false,
      },
    },
  },
};

function database() {
  const store = new runtime.RuntimeStore(':memory:', {
    communityId: 'private-import-probe',
    modules: [
      { ...runtime.contentModule, initialState: () => runtime.contentModule.initialState({ profile }) },
      runtime.lifecycleModule,
    ],
  });
  store.transact(state => {
    state.modules.content = runtime.importContent(state.modules.content, bundle);
  });
  store.transact(state => {
    state.modules.content = runtime.publishContent(state.modules.content, {
      entityId: 'guide-answer', revisionId: 'answer-revision-17', expectedVersion: 0,
      now: new Date(now).toISOString(),
    });
  });
  return store;
}

const original = database();
const destination = database();
try {
  original.transact(state => runtime.lifecycleCommand(state, principal, {
    action: 'create', id: 'probe-record', type: 'report', payload: { message: 'Synthetic report' },
    entityId: 'guide-answer', revisionId: 'answer-revision-17',
  }, options));
  let normalTransition;
  try {
    original.transact(state => runtime.lifecycleCommand(state, principal, {
      action: 'transition', id: 'probe-record', expectedVersion: 0,
      status: 'resolved', decisionCode: 'unconfigured',
    }, options));
    normalTransition = 'accepted';
  } catch (error) { normalTransition = error.code; }

  const snapshot = original.read().modules.lifecycle;
  // A migration input must not introduce results that the configured workflow rejects.
  snapshot.records['probe-record'].publicResult = { code: 'unconfigured', label: 'UNCONFIGURED_RESULT' };
  let snapshotImport;
  try {
    destination.transact(state => runtime.lifecycleCommand(state, principal, {
      action: 'import', data: snapshot,
    }, options));
    snapshotImport = 'accepted';
  } catch (error) { snapshotImport = error.code; }
  const results = runtime.lifecyclePublicResults(destination.read(), { config: options.config, now });
  const unexpectedPublicResult = results.some(item => item.result.code === 'unconfigured');
  original.transact(state => runtime.lifecycleCommand(state, principal, {
    action: 'transition', id: 'probe-record', expectedVersion: 0,
    status: 'resolved', decisionCode: 'corrected',
  }, options));
  const configuredResults = runtime.lifecyclePublicResults(original.read(), { config: options.config, now });
  console.log(JSON.stringify({ normalTransition, snapshotImport, unexpectedPublicResult, results, configuredResults }, null, 2));
  if (unexpectedPublicResult) process.exitCode = 1;
} finally {
  original.close();
  destination.close();
}
