/**
 * PostgreSQL connectivity foundation (Phase 1B).
 *
 * The pool is LAZY: importing this module never opens a connection. The API
 * must keep working when the database is down; readiness is surfaced via
 * GET /ready (see app.ts), which calls checkDatabaseConnection().
 *
 * Full query/entity code lands in Phase 2 (docs/DATABASE.md).
 */
import { Pool, type PoolClient } from "pg";
import { config } from "./config.js";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!config.database.url) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: config.database.url,
      max: 10,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 2_000,
      statement_timeout: 2_000,
    });
  }
  return pool;
}

/** True when a real `SELECT 1` round-trip succeeds. Never throws. */
export async function checkDatabaseConnection(): Promise<boolean> {
  if (!config.database.url) {
    return false;
  }
  const client = await getPool().connect();
  try {
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    client.release();
  }
}

/** Releases the pool (used by tests/shutdown). */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/**
 * Runs `fn` inside a single transaction (BEGIN/COMMIT, ROLLBACK on error).
 * Useful for multi-statement operations that must be atomic (e.g. creating a
 * user + role assignment + first refresh token).
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
