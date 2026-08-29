declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    EDITOR_EMAILS?: string;
    RESEARCH_INTAKE_SECRET?: string;
    MAINTENANCE_SECRET?: string;
    SEED_DEMO_CONTENT?: string;
  }
}
