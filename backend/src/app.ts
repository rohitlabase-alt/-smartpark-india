import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from "express";
import { APP_NAME, APP_VERSION, ApiError, HealthResponse } from "@smartpark/shared";

/**
 * Builds the Express application (no side effects — importable for tests).
 * Business logic is intentionally absent in Phase 1A (docs/ARCHITECTURE.md §3).
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json());

  // Health —— Phase 1A contract (docs/API_SPEC.md conventions).
  app.get("/health", (_req: Request, res: Response) => {
    const body: HealthResponse = {
      status: "ok",
      service: `${APP_NAME} API`,
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
    };
    res.json(body);
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
    _next: unknown
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