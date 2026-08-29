declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    EDITOR_EMAILS?: string;
    AUTH_PROXY_SECRET?: string;
    EDITOR_LOGIN_SECRET?: string;
    EDITOR_SESSION_SECRET?: string;
    PILOT_SECRET?: string;
    PILOT_WINDOW_START?: string;
    PILOT_WINDOW_END?: string;
    MAINTENANCE_SECRET?: string;
    SEED_DEMO_CONTENT?: string;
  }
}
