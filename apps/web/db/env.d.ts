declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    EDITOR_EMAILS?: string;
    AUTH_PROXY_SECRET?: string;
    EDITOR_LOGIN_SECRET?: string;
    EDITOR_SESSION_SECRET?: string;
    EDITOR_ENABLE_LEGACY_LOGIN?: string;
    EDITOR_PASSWORD_PEPPER?: string;
    EDITOR_MFA_KEY_V1?: string;
    EDITOR_BOOTSTRAP_EMAIL?: string;
    EDITOR_BOOTSTRAP_NAME?: string;
    EDITOR_BOOTSTRAP_PASSWORD?: string;
    EDITOR_BOOTSTRAP_TOTP_SECRET?: string;
    EDITOR_RATE_LIMIT_SECRET?: string;
    PRIVATE_INTAKE_KEY_V1?: string;
    PILOT_SECRET?: string;
    PILOT_WINDOW_START?: string;
    PILOT_WINDOW_END?: string;
    MAINTENANCE_SECRET?: string;
    PUBLIC_ORIGIN?: string;
    SEED_DEMO_CONTENT?: string;
  }
}
