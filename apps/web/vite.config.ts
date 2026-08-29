import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, loadEnv } from 'vite';
import hostingConfig from './.openai/hosting.json' with { type: 'json' };

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

export default defineConfig(async ({ command, mode }) => {
  const runtimeEnv = loadEnv(mode, process.cwd(), '');
  const localRuntimeValue = (name: string) =>
    command === 'serve' ? (process.env[name] ?? runtimeEnv[name] ?? '') : '';
  const localBindingConfig = {
    main: 'vinext/server/fetch-handler',
    compatibility_flags: ['nodejs_compat'],
    observability: { enabled: false },
    vars: {
      EDITOR_EMAILS: localRuntimeValue('EDITOR_EMAILS'),
      AUTH_PROXY_SECRET: localRuntimeValue('AUTH_PROXY_SECRET'),
      EDITOR_LOGIN_SECRET: localRuntimeValue('EDITOR_LOGIN_SECRET'),
      EDITOR_SESSION_SECRET: localRuntimeValue('EDITOR_SESSION_SECRET'),
      PILOT_SECRET: localRuntimeValue('PILOT_SECRET'),
      PILOT_WINDOW_START: localRuntimeValue('PILOT_WINDOW_START'),
      PILOT_WINDOW_END: localRuntimeValue('PILOT_WINDOW_END'),
      MAINTENANCE_SECRET: localRuntimeValue('MAINTENANCE_SECRET'),
      SEED_DEMO_CONTENT:
        localRuntimeValue('SEED_DEMO_CONTENT') ||
        (command === 'serve' ? 'true' : 'false'),
    },
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: 'site-creator-d1',
            database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: 'site-creator-r2',
          },
        ]
      : [],
  };
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
