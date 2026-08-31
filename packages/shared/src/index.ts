/**
 * SmartPark India — shared constants, types and API contracts.
 *
 * Purpose: a single source of truth consumed by the web app and the API.
 * Phase 1A: foundation constants that already exist (APP_*, API_NAMESPACE).
 * Phase 2A: authentication, RBAC, user, operator and parking contracts.
 *
 * Conventions (docs/API_SPEC.md):
 * - Entities are exposed over the API in camelCase (DB stores snake_case).
 * - Errors use the standard { error: { code, message, details? } } envelope.
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

// ---------------------------------------------------------------------------
// Roles & RBAC (docs/DATABASE.md §2.2, docs/ARCHITECTURE.md §3)
// ---------------------------------------------------------------------------

/**
 * Documented V1 role catalogue (docs/DATABASE.md §2.2). Phase 2A seeds and
 * implements USER / PARKING_OPERATOR / ADMIN; the remaining roles land with
 * their feature phases (gate, operator staff, verifier/admin review).
 */
export const USER_ROLES = [
  "USER",
  "GATE_STAFF",
  "PARKING_OPERATOR",
  "OPERATOR_MANAGER",
  "VERIFIER",
  "ADMIN",
] as const;

export type UserRoleCode = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRoleCode, string> = {
  USER: "Customer",
  GATE_STAFF: "Gate Staff",
  PARKING_OPERATOR: "Parking Operator",
  OPERATOR_MANAGER: "Operator Manager",
  VERIFIER: "Verifier",
  ADMIN: "Administrator",
};

/** Roles seeded/implemented by Phase 2A. */
export const PHASE_2A_ROLES: readonly UserRoleCode[] = ["USER", "PARKING_OPERATOR", "ADMIN"];

export const USER_STATUSES = ["ACTIVE", "SUSPENDED", "PENDING"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// ---------------------------------------------------------------------------
// Users (docs/DATABASE.md §2.1) — public profile never includes password data
// ---------------------------------------------------------------------------

export interface PublicUser {
  id: number;
  email: string;
  fullName: string | null;
  phone: string | null;
  locale: string;
  status: UserStatus;
  roles: UserRoleCode[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Operators (docs/DATABASE.md §2.4)
// ---------------------------------------------------------------------------

export const OPERATOR_STATUSES = [
  "PENDING",
  "UNDER_REVIEW",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
  "ACTIVE",
  "INACTIVE",
] as const;
export type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

export interface Operator {
  id: number;
  name: string;
  businessType: string | null;
  registrationNumber: string | null;
  verificationStatus: OperatorStatus;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Parking facilities (docs/DATABASE.md §2.6)
// ---------------------------------------------------------------------------

export const FACILITY_TYPES = [
  "public",
  "private",
  "on-street",
  "off-street",
  "mall",
  "airport",
  "railway-metro",
  "hospital",
  "corporate",
  "ev",
] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const AVAILABILITY_MODES = ["MANUAL", "API", "IOT"] as const;
export type AvailabilityMode = (typeof AVAILABILITY_MODES)[number];

export interface ParkingFacility {
  id: number;
  parkingId: string;
  name: string;
  description: string | null;
  type: FacilityType;
  country: string;
  state: string | null;
  city: string;
  area: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  operatorId: number;
  capacity: number;
  verificationStatus: OperatorStatus; // shares the §2.4 vocabulary
  availabilityMode: AvailabilityMode;
  isActive: boolean;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Auth contracts (docs/API_SPEC.md §2 auth, §6)
// ---------------------------------------------------------------------------

export interface RegisterRequest {
  email: string;
  password: string;
  fullName?: string;
  phone?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: PublicUser;
}

export interface OperatorRegisterRequest {
  name: string;
  businessType?: string;
  registrationNumber?: string;
}

export interface CreateFacilityRequest {
  name: string;
  type: FacilityType;
  city: string;
  state?: string;
  area?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  capacity: number;
  description?: string;
}

export interface UpdateFacilityRequest {
  name?: string;
  description?: string;
  type?: FacilityType;
  city?: string;
  state?: string;
  area?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  capacity?: number;
  isActive?: boolean;
}
