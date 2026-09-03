import express, { type Express, type Request, type Response } from "express";
import { APP_NAME, APP_VERSION, HealthResponse } from "@smartpark/shared";
import { checkDatabaseConnection } from "./db.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { operatorsRouter } from "./modules/operators/operators.routes.js";
import { parkingRouter } from "./modules/availability/availability.routes.js";
import { buildSlotsRouter } from "./modules/parking/slots.routes.js";
import { reservationsRouter } from "./modules/bookings/reservations.routes.js";
import { errorHandler, notFoundHandler } from "./http/error-handler.js";
import { config } from "./config.js";

export interface CreateAppOptions {
  /**
   * Readiness probe for the database. Injectable so tests stay deterministic
   * without a live postgres. Defaults to the real connection check.
   */
  checkDatabaseReady?: () => Promise<boolean>;
  /** CORS allowlist override for deterministic tests. */
  corsOrigins?: string[];
}

function corsMiddleware(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: () => void): void => {
    const origin = req.header("Origin");
    if (!origin) {
      next();
      return;
    }

    res.vary("Origin");
    if (!allowedOrigins.includes(origin)) {
      if (req.method === "OPTIONS") {
        res
          .status(403)
          .json({ error: { code: "CORS_ORIGIN_DENIED", message: "Origin is not allowed" } });
        return;
      }
      next();
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PATCH,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

/**
 * Builds the Express application (no side effects — importable for tests).
 * Business logic lives in `backend/src/modules/*` (docs/ARCHITECTURE.md §3);
 * this file only wires middleware, health endpoints, the API namespace mount,
 * and the shared 404/error handlers.
 */
export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const checkDatabaseReady = options.checkDatabaseReady ?? checkDatabaseConnection;

  app.use(corsMiddleware(options.corsOrigins ?? config.corsOrigins));
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

  // Versioned API namespace (docs/API_SPEC.md base path /api/v1).
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/operators", operatorsRouter);

  // Operator-owned slot management (Phase 2B): /operators/me/facilities/:id/slots
  const slotsRouter = buildSlotsRouter();
  app.use("/api/v1/operators/me/facilities", slotsRouter);

  // Public parking availability (Phase 2B): /parking/:id/availability
  app.use("/api/v1/parking", parkingRouter);

  // Reservations / bookings (Phase 2C): /reservations (auth required)
  app.use("/api/v1/reservations", reservationsRouter);

  // JSON 404 for unknown routes.
  app.use(notFoundHandler);

  // Central error handler (HttpError + parse failures → mapped status;
  // anything else → 500). Never leaks internals (docs/SECURITY.md).
  app.use(errorHandler);

  return app;
}
