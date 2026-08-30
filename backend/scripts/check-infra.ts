/**
 * Infra reachability check (Phase 1B).
 *
 *   npm run check:infra -w @smartpark/api
 *
 * Verifies the three dev services the API will rely on, WITHOUT wiring them
 * into the request path yet:
 *   postgres — `SELECT 1` (via checkDatabaseConnection)
 *   minio    — bucket ensure + put/head/get/delete round-trip
 *   anvil    — eth_chainId JSON-RPC round-trip, chain id match
 *
 * Exits non-zero if any service is unreachable or misconfigured.
 * Requires `npm run infra:up` first (or local equivalents).
 */
import "../src/env.js";
import { checkDatabaseConnection } from "../src/db.js";
import { config } from "../src/config.js";
import { S3StorageProvider } from "../src/storage/s3.js";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function checkPostgres(): Promise<CheckResult> {
  try {
    const ok = await checkDatabaseConnection();
    return {
      name: "postgres",
      ok,
      detail: ok
        ? "SELECT 1 round-trip OK"
        : config.database.url
          ? "connection failed (is infra up? see .env)"
          : "DATABASE_URL not set (see .env.example)",
    };
  } catch (err) {
    return { name: "postgres", ok: false, detail: String(err) };
  }
}

async function checkMinio(): Promise<CheckResult> {
  try {
    const provider = new S3StorageProvider();
    await provider.ensureBucket();
    const bucket = config.storage.bucket;
    const probeKey = `__health_probe__/${Date.now()}`;
    await provider.put(bucket, probeKey, Buffer.from("ok"));
    const meta = await provider.head(bucket, probeKey);
    const body = await provider.getObject(bucket, probeKey);
    await provider.delete(bucket, probeKey);
    const valid = meta.sizeBytes === 2 && body.toString() === "ok";
    return {
      name: "minio",
      ok: valid,
      detail: valid
        ? `bucket "${bucket}" ready; put/head/get/delete round-trip OK`
        : "round-trip returned unexpected data",
    };
  } catch (err) {
    return { name: "minio", ok: false, detail: String(err) };
  }
}

async function checkAnvil(): Promise<CheckResult> {
  const url = config.blockchain.anvilRpcUrl;
  if (!url) {
    return { name: "anvil", ok: false, detail: "ANVIL_RPC_URL not set (see .env.example)" };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
    });
    if (!res.ok) return { name: "anvil", ok: false, detail: `HTTP ${res.status}` };
    const json = (await res.json()) as { result?: string };
    const chainIdHex = Number.parseInt(json.result ?? "0x0", 16);
    const expected = config.blockchain.chainId;
    const ok = chainIdHex === expected;
    return {
      name: "anvil",
      ok,
      detail: ok
        ? `eth_chainId OK (0x${chainIdHex.toString(16)}, matches ANVIL_CHAIN_ID)`
        : `chain id ${chainIdHex} does not match ANVIL_CHAIN_ID=${expected}`,
    };
  } catch (err) {
    return { name: "anvil", ok: false, detail: String(err) };
  }
}

async function main(): Promise<void> {
  const results = await Promise.all([checkPostgres(), checkMinio(), checkAnvil()]);
  let failed = 0;
  for (const r of results) {
    console.log(`[check:infra] ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(9)} ${r.detail}`);
    if (!r.ok) failed += 1;
  }
  console.log(`[check:infra] ${results.length - failed}/${results.length} services healthy`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[check:infra] unexpected failure:", err);
  process.exitCode = 1;
});
