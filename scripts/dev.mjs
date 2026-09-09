import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { openRuntime } from '@information-community/runtime';
import { startGuide } from '../server/guide.mjs';
import { initializeDemo } from './demo.mjs';

const root = resolve('community');
const load = async name => JSON.parse(await readFile(resolve(root, name), 'utf8'));
let secrets;
try { secrets = await load('.dev-secrets.json'); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  secrets = { mfaKey: randomBytes(32).toString('hex'), keyring: { activeVersion: 'dev', keys: { dev: randomBytes(32).toString('hex') } } };
  await writeFile(resolve(root, '.dev-secrets.json'), JSON.stringify(secrets), { flag: 'wx', mode: 0o600 });
}
const config = { ...await load('runtime.config.json'), dataDirectory: '.demo-runtime' };
await writeFile(resolve(root, 'runtime.demo.json'), JSON.stringify(config, null, 2));
const runtime = await openRuntime({ root, configFile: 'runtime.demo.json', seed: false });
try {
  initializeDemo(runtime.store, await load('content.json'));
} finally { runtime.store.close(); }
const env = { ...process.env, RUNTIME_MFA_KEY: secrets.mfaKey, RUNTIME_KEYRING: JSON.stringify(secrets.keyring) };
let app;
for (let port = Number(process.env.PORT ?? 4317); port < 4340; port++) {
  try { app = await startGuide({ root, configFile: 'runtime.demo.json', env, port, host: '127.0.0.1' }); break; }
  catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
}
if (!app) throw new Error('No available demo port.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close(); app.closeIdleConnections(); });
