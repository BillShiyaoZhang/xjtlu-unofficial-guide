import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function getDb() {
  if (!env.DB) {
    throw new Error(
      'Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database.',
    );
  }

  return drizzle(env.DB, { schema });
}

export function getD1(): D1Database {
  if (!env.DB) {
    throw new Error('Cloudflare D1 binding `DB` is unavailable.');
  }

  return env.DB;
}

export function getRuntimeValue(
  name:
    | 'EDITOR_EMAILS'
    | 'AUTH_PROXY_SECRET'
    | 'EDITOR_LOGIN_SECRET'
    | 'EDITOR_SESSION_SECRET'
    | 'PILOT_SECRET'
    | 'PILOT_WINDOW_START'
    | 'PILOT_WINDOW_END'
    | 'MAINTENANCE_SECRET'
    | 'SEED_DEMO_CONTENT',
) {
  const bindingValue = env[name];
  if (bindingValue) return bindingValue;

  return process.env[name];
}
