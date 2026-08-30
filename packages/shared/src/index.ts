/**
 * SmartPark India — shared constants, types and API contracts.
 *
 * Purpose: a single source of truth consumed by the web app and the API.
 * No business models here yet (Phase 1A foundation only).
 */

export const APP_NAME = "SmartPark India";
export const APP_TAGLINE = "Find · Compare · Reserve · Pay · Token · Verify · Park · Exit";
export const APP_VERSION = "0.1.0";
export const MVP_STATUS = "Pune MVP";
export const MODE_STATUS = "Workspace Foundation";

export const API_NAMESPACE = "/api/v1";

/**
 * Health check contract for the API.
 * JSON shape returned by GET /health (Phase 1A).
 */
export interface HealthResponse {
  status: "ok";
  service: string;
  version: string;
  timestamp: string;
}

/**
 * Standard API error envelope (agrees with docs/API_SPEC.md §1).
 */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}