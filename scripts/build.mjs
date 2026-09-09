import { resolve } from 'node:path';
import { loadRuntimeConfig, buildRuntime } from '@information-community/runtime';
const runtime = await loadRuntimeConfig({ root: resolve('community') });
const result = await buildRuntime(runtime);
console.log(`Built content-free UI: ${result.output}`);
