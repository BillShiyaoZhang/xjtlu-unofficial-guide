import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
const entry = fileURLToPath(import.meta.resolve('@information-community/runtime'));
const args = process.argv.slice(2);
const demo = args[0] === '--demo';
if (demo) args.shift();
if (args[0] === 'start') throw new Error('Use npm start (or npm run dev) so the guide business rules remain enforced.');
for (let index = 1; index < args.length; index++) args[index] = resolve(args[index]);
process.chdir(resolve(process.env.GUIDE_ROOT ?? 'community'));
const env = { ...process.env };
if (demo) {
  const secrets = JSON.parse(await readFile('.dev-secrets.json', 'utf8'));
  Object.assign(env, { RUNTIME_CONFIG: 'runtime.demo.json', RUNTIME_MFA_KEY: secrets.mfaKey, RUNTIME_KEYRING: JSON.stringify(secrets.keyring) });
}
const { main } = await import(pathToFileURL(resolve(dirname(entry), 'cli.mjs')));
await main(args, env);
