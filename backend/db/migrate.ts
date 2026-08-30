/**
 * Minimal versioned-SQL migration runner (docs/DATABASE.md conventions:
 * "Migrations as versioned SQL files in backend/db/migrations/").
 *
 *   npm run db:migrate -w @smartpark/api
 *
 * Applies pending `NNNN_name.sql` files in filename order, each inside a
 * transaction, recording applied versions in `schema_migrations`. Safe to run
 * repeatedly. Exits non-zero on failure (nothing partially applied).
 */
import "../src/env.js";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations/", import.meta.url));

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[db:migrate] DATABASE_URL is not set (see .env.example)");
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const { rows } = await client.query("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.version as string));

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[db:migrate] skip ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`[db:migrate] apply ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        appliedCount += 1;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    const pendingCount = files.length - applied.size - appliedCount;
    console.log(
      `[db:migrate] done — applied ${appliedCount}, skipped ${applied.size}, pending ${pendingCount}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[db:migrate] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
