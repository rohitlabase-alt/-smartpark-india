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

export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiBaseUrl: string;
  database: DatabaseConfig;
  storage: StorageConfig;
  blockchain: BlockchainConfig;
}

export const config: AppConfig = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  // Backward-compatible with the Phase 1A PORT variable.
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 4000),
  apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:4000/api/v1",
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
};
