/**
 * Environment-derived configuration (Phase 1A).
 * No .env loading library yet — values come from process.env with
 * development defaults. A database connection is NOT required (Phase 1A).
 */
export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:4000/api/v1",
  /** Placeholder only. Required from Phase 2 (docs/DATABASE.md). */
  databaseUrl: process.env.DATABASE_URL,
};