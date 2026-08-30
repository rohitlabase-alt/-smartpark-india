import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from "express";
import { APP_NAME, APP_VERSION, ApiError, HealthResponse } from "@smartpark/shared";
import { checkDatabaseConnection } from "./db.js";

export interface CreateAppOptions {
  /**
   * Readiness probe for the database. Injectable so tests stay deterministic
   * without a live postgres. Defaults to the real connection check.
   */
  checkDatabaseReady?: () => Promise<boolean>;
}

/**
 * Builds the Express application (no side effects — importable for tests).
 * Business logic is intentionally absent (docs/ARCHITECTURE.md §3).
 */
export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const checkDatabaseReady = options.checkDatabaseReady ?? checkDatabaseConnection;

  app.use(express.json());

  // Health —— liveness contract (docs/API_SPEC.md). Deliberately independent
  // of any dependency so load balancers can distinguish liveness from readiness.
  app.get("/health", (_req: Request, res: Response) => {
    const body: HealthResponse = {
      status: "ok",
      service: `${APP_NAME} API`,
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
    };
    res.json(body);
  });

  // Readiness —— dependency readiness (Phase 1B). Postgres is the only
  // tracked dependency for now; minio/anvil are verified via
  // `npm run check:infra` (scripts/check-infra.ts). 503 when not ready.
  app.get("/ready", async (_req: Request, res: Response) => {
    const postgresReady = await checkDatabaseReady();
    const body = {
      status: postgresReady ? "ready" : "not_ready",
      services: { postgres: postgresReady ? "ok" : "unavailable" },
    };
    res.status(postgresReady ? 200 : 503).json(body);
  });

  // JSON 404 for unknown routes.
  app.use((_req: Request, res: Response) => {
    const body: ApiError = {
      error: { code: "NOT_FOUND", message: "Route not found" },
    };
    res.status(404).json(body);
  });

  // Central error handler (kept minimal; no business logic).
  const onError: ErrorRequestHandler = (
    err: unknown,
    _req: Request,
    res: Response,
    _next: unknown,
  ) => {
    console.error("[api] unhandled error:", err);
    const body: ApiError = {
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error" },
    };
    res.status(500).json(body);
  };
  app.use(onError);

  return app;
}
