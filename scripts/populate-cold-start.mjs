import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTopicsConfig } from '../community/pages-ui/topic-model.js';

const directory = new URL('../community/', import.meta.url);

/** Append an explicitly selected batch. Existing topic IDs must match exactly. */
export function appendColdStartBatch(config, batch, catalog) {
  validateTopicsConfig(config, catalog);
  const checked = validateTopicsConfig(batch, catalog);
  if (checked.topics.some(topic => !topic.collection || !topic.sources.some(source => source.accessStatus === 'read'))) {
    throw new Error('Cold-start topics require a collection with an actually read source');
  }
  const topics = [...config.topics];
  let added = 0;
  for (const topic of checked.topics) {
    const existing = topics.find(row => row.id === topic.id);
    if (existing) {
      const normalized = validateTopicsConfig({ schemaVersion: 1, topics: [existing] }, catalog).topics[0];
      if (JSON.stringify(normalized) !== JSON.stringify(topic)) throw new Error(`Cold-start topic ${topic.id} already exists with different content; review it manually`);
    } else { topics.push(topic); added++; }
  }
  return { config: validateTopicsConfig({ schemaVersion: 1, topics }, catalog), added };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { checkOnly, batchName } = parseBatchOptions(process.argv.slice(2));
  const [config, batch, catalog] = await Promise.all(['community-topics.json', `cold-start/${batchName}`, 'catalog.json']
    .map(async name => JSON.parse(await readFile(new URL(name, directory), 'utf8'))));
  const result = appendColdStartBatch(config, batch, catalog);
  if (!checkOnly && result.added) await writeFile(new URL('community-topics.json', directory), JSON.stringify(result.config, null, 2) + '\n');
  console.log(`${checkOnly ? 'Checked' : 'Populated'} ${batch.topics.length} sourced cold-start topics; ${result.added} ${checkOnly ? 'to add' : 'added'}. Total: ${result.config.topics.length}.`);
}

export function parseBatchOptions(args) {
  let checkOnly = false, batchName = '2026-09-10.json';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') checkOnly = true;
    else if (args[i] === '--batch' && /^[a-z0-9][a-z0-9_-]*\.json$/.test(args[i + 1] ?? '')) batchName = args[++i];
    else throw new Error('Usage: node scripts/populate-cold-start.mjs [--check] [--batch filename.json]');
  }
  return { checkOnly, batchName };
}
