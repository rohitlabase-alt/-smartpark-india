/**
 * Environment-derived configuration (Phase 1B).
 * Values come from process.env (optionally loaded from .env via dotenv).
 * No service is REQUIRED at startup — the API boots without postgres/
 * minio/anvil; readiness is reported separately (GET /ready).
 */
export interface DatabaseConfig {
  /** Connection string (postgres://user:pass@host:port/db). Undefined = not configured. */
  url: string | undefined;
}

export interface StorageConfig {
  /** Host without scheme, e.g. `localhost` (S3-compatible providers). */
  endpoint: string;
  /** Port on which the S3 API listens (MinIO default 9000). */
  port: number;
  accessKey: string;
  secretKey: string;
  /** Default bucket used by the storage layer / init checks. */
  bucket: string;
  region: string;
  /** MinIO/self-hosted S3 requires path-style addressing. */
  forcePathStyle: boolean;
  /** Short-lived signed GET URL TTL (docs/ARCHITECTURE.md §12.5, default 300 s). */
  signedUrlTtlSeconds: number;
}

export interface BlockchainConfig {
  /** Anvil JSON-RPC endpoint. Dev only (docs/BLOCKCHAIN.md). */
  anvilRpcUrl: string | undefined;
  chainId: number;
}

export interface AuthConfig {
  /**
   * HMAC secret for access-token JWTs. MUST come from the environment
   * (docs/SECURITY.md) — no default secret is ever shipped. When unset,
   * auth operations fail closed with a clear configuration error.
   */
  jwtSecret: string | undefined;
  /** Access-token lifetime in seconds (default 30 min, docs/SECURITY.md). */
  jwtExpiresInSeconds: number;
  /** Refresh-token lifetime in seconds (default 30 days). */
  refreshTokenTtlSeconds: number;
  /** JWT issuer claim. */
  issuer: string;
  /** JWT audience claim (matches the API namespace). */
  audience: string;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiBaseUrl: string;
  corsOrigins: string[];
  database: DatabaseConfig;
  storage: StorageConfig;
  blockchain: BlockchainConfig;
  auth: AuthConfig;
}

/**
 * Parses "1800" (seconds), "30m", "1h", "7d" style durations.
 * Throws on malformed input so misconfiguration fails fast at import time.
 */
export function parseDurationToSeconds(value: string): number {
  const match = /^(\d+)(s|m|h|d)?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: "${value}" (expected e.g. 1800, 30m, 1h, 7d)`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  const factor = { s: 1, m: 60, h: 3600, d: 86400 }[unit]!;
  return amount * factor;
}

export const config: AppConfig = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  // Backward-compatible with the Phase 1A PORT variable.
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 4000),
  apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:4000/api/v1",
  // Local development is intentionally scoped to the Vite origin. Production
  // must provide an explicit comma-separated allowlist and never falls back to
  // a wildcard origin.
  corsOrigins: (
    process.env.CORS_ORIGINS ??
    (process.env.NODE_ENV === "production" ? "" : "http://localhost:5173")
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== "*"),
  database: {
    url: process.env.DATABASE_URL || undefined,
  },
  storage: {
    endpoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: Number(process.env.MINIO_PORT ?? 9000),
    accessKey: process.env.MINIO_ACCESS_KEY ?? "smartpark-minio",
    secretKey: process.env.MINIO_SECRET_KEY ?? "smartpark-minio-secret",
    bucket: process.env.MINIO_BUCKET ?? "smartpark-documents",
    region: process.env.MINIO_REGION ?? "us-east-1",
    forcePathStyle: true,
    signedUrlTtlSeconds: Number(process.env.SIGNED_URL_TTL_SECONDS ?? 300),
  },
  blockchain: {
    anvilRpcUrl: process.env.ANVIL_RPC_URL || undefined,
    chainId: Number(process.env.ANVIL_CHAIN_ID ?? 31337),
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || undefined,
    jwtExpiresInSeconds: parseDurationToSeconds(process.env.JWT_EXPIRES_IN ?? "30m"),
    refreshTokenTtlSeconds: parseDurationToSeconds(process.env.REFRESH_TOKEN_EXPIRES_IN ?? "30d"),
    issuer: "SmartPark India API",
    audience: "/api/v1",
  },
};
