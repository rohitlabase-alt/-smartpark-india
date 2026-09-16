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
  approvedBy: number | null;
  approvedAt: string | null;
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

// ---------------------------------------------------------------------------
// Parking slots & availability (docs/DATABASE.md §2.8/§2.20, docs/API_SPEC.md)
// ---------------------------------------------------------------------------

/** Authoritative slot status vocabulary (docs/DATABASE.md §2.8). */
export const PARKING_SLOT_STATUSES = [
  "AVAILABLE",
  "RESERVED",
  "OCCUPIED",
  "OUT_OF_SERVICE",
  "MAINTENANCE",
  "UNKNOWN",
] as const;
export type ParkingSlotStatus = (typeof PARKING_SLOT_STATUSES)[number];

/** Normalized engine status vocabulary (docs/DATABASE.md §2.20). */
export const AVAILABILITY_STATES = ["AVAILABLE", "OCCUPIED", "RESERVED", "UNKNOWN"] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

/** Availability source vocabulary (docs/DATABASE.md §2.20). Phase 2B writes MANUAL only. */
export const AVAILABILITY_SOURCES = ["MANUAL", "API", "IOT", "RESERVATION"] as const;
export type AvailabilitySource = (typeof AVAILABILITY_SOURCES)[number];

/** Availability confidence vocabulary (docs/DATABASE.md §2.20). */
export const AVAILABILITY_CONFIDENCES = [
  "HIGH",
  "MEDIUM_HIGH",
  "MEDIUM",
  "LOW",
  "UNKNOWN",
] as const;
export type AvailabilityConfidence = (typeof AVAILABILITY_CONFIDENCES)[number];

export interface ParkingSlot {
  id: number;
  slotCode: string;
  facilityId: number;
  zoneId: number | null;
  vehicleType: string;
  status: ParkingSlotStatus;
  reservationsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Availability summary derived deterministically from slot/engine state
 * (docs/API_SPEC.md §3 + a per-status breakdown). `isLive` is derived from
 * confidence/freshness; Phase 2B always reports MANUAL source.
 */
export interface AvailabilitySummary {
  facilityId: string;
  total: number;
  available: number;
  occupied: number;
  reserved: number;
  outOfService: number;
  maintenance: number;
  unknown: number;
  isLive: boolean;
  confidence: AvailabilityConfidence;
  lastUpdatedAt: string;
  source: AvailabilitySource;
}

/** Public availability read (docs/API_SPEC.md §3) — the full honesty contract. */
export interface FacilityAvailabilityResponse {
  facilityId: string;
  totalSlots: number;
  availableSlots: number;
  isLive: boolean;
  sources: AvailabilitySource[];
  lastUpdatedAt: string;
  confidence: AvailabilityConfidence;
  disclaimer: string;
  slots: ParkingSlot[];
}

export interface CreateSlotRequest {
  slotCode: string;
  vehicleType?: string;
  status?: ParkingSlotStatus;
  reservationsEnabled?: boolean;
}

export interface UpdateSlotRequest {
  vehicleType?: string;
  status?: ParkingSlotStatus;
  reservationsEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Bookings / reservations (docs/DATABASE.md §2.12, docs/API_SPEC.md §2)
// ---------------------------------------------------------------------------

/**
 * Reservation lifecycle (docs/DATABASE.md §2.12, docs/PRD.md §10). Phase 7
 * activates the payment states (PENDING_PAYMENT/ACTIVE/EXPIRED/FAILED) alongside
 * the earlier CONFIRMED/CANCELLED/COMPLETED subset (Phase 2C, D-034).
 */
export const RESERVATION_STATES = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
  "FAILED",
] as const;
export type ReservationState = (typeof RESERVATION_STATES)[number];

/** Product-facing alias for a reservation's state. */
export type BookingStatus = ReservationState;

/**
 * Payment lifecycle statuses (docs/DATABASE.md §2.15, docs/DECISIONS.md D-010).
 */
export const PAYMENT_STATUSES = ["INITIATED", "PENDING", "SUCCESS", "FAILED", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Payment providers (docs/ROADMAP.md PHASE 7 — mock only in V1). */
export const PAYMENT_PROVIDERS = ["MOCK"] as const;
export type PaymentProviderCode = (typeof PAYMENT_PROVIDERS)[number];

/** Ledger transaction kinds (docs/DATABASE.md §2.16). */
export const PAYMENT_TRANSACTION_KINDS = ["CHARGE", "REFUND", "REVERSAL"] as const;
export type PaymentTransactionKind = (typeof PAYMENT_TRANSACTION_KINDS)[number];

/** Ledger transaction statuses (docs/DATABASE.md §2.16 capturable semantics). */
export const PAYMENT_TRANSACTION_STATUSES = ["SUCCESS", "FAILED"] as const;
export type PaymentTransactionStatus = (typeof PAYMENT_TRANSACTION_STATUSES)[number];

export interface Reservation {
  id: number;
  reservationCode: string;
  userId: number;
  facilityId: number;
  zoneId: number | null;
  slotId: number | null;
  startsAt: string;
  endsAt: string;
  state: ReservationState;
  amount: number | null;
  paymentStatus: PaymentStatus | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBookingRequest {
  facilityId: number;
  slotId?: number;
  startsAt: string;
  endsAt: string;
}

export interface BookingResponse {
  reservation: Reservation;
}

export interface BookingListResponse {
  reservations: Reservation[];
}

// ---------------------------------------------------------------------------
// Payments (docs/DATABASE.md §2.15/§2.16, docs/API_SPEC.md §2 payments)
// ---------------------------------------------------------------------------

export interface Payment {
  id: number;
  reservationId: number;
  provider: PaymentProviderCode;
  providerTxnId: string | null;
  amount: number;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

/** Initiate a mock payment for a PENDING_PAYMENT reservation (API_SPEC §2). */
export interface InitiatePaymentRequest {
  reservationCode: string;
}

export interface InitiatePaymentResponse {
  payment: Payment;
}

export interface VerifyPaymentResponse {
  payment: Payment;
  reservation: Reservation;
}

// ---------------------------------------------------------------------------
// Audit trail (docs/DATABASE.md §2.23, docs/API_SPEC.md §2 admin — Phase 8,
// Part 4). Audit events are server-generated, append-only records of admin and
// platform actions. actors come from the authenticated server-side session.
// ---------------------------------------------------------------------------

/**
 * Documented audit event vocabulary. Only actions that actually exist in the
 * current workflows are emitted (Phase 8 Part 4).
 */
export const AUDIT_ACTIONS = [
  "OPERATOR_REVIEWED",
  "OPERATOR_APPROVED",
  "OPERATOR_REJECTED",
  "OPERATOR_REGISTERED",
  "FACILITY_REVIEWED",
  "FACILITY_APPROVED",
  "FACILITY_REJECTED",
  "FACILITY_ACTIVATED",
  "FACILITY_DEACTIVATED",
  "FACILITY_CREATED",
  "FACILITY_UPDATED",
  "SLOT_CREATED",
  "SLOT_UPDATED",
  "RESERVATION_CREATED",
  "RESERVATION_CANCELLED",
  "PAYMENT_INITIATED",
  "PAYMENT_VERIFIED",
] as const;
export type AuditEventAction = (typeof AUDIT_ACTIONS)[number];

/** Entity kinds that audit events reference (docs/DATABASE.md §2.23). */
export const AUDIT_ENTITY_TYPES = [
  "OPERATOR",
  "FACILITY",
  "SLOT",
  "RESERVATION",
  "PAYMENT",
  "USER",
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/**
 * An audit event. `actorEmail` is resolved server-side from the actor's
 * account at read time and only ever surfaced through the ADMIN-only API.
 */
export interface AuditEvent {
  id: number;
  actorUserId: number | null;
  actorEmail: string | null;
  action: AuditEventAction;
  entityType: AuditEntityType;
  entityId: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Filter options accepted by GET /api/v1/admin/audit-events. */
export interface AuditEventFilters {
  action?: AuditEventAction;
  entityType?: AuditEntityType;
  actorUserId?: number;
  entityId?: number;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

/** Response envelope for GET /api/v1/admin/audit-events. */
export interface AuditEventListResponse {
  events: AuditEvent[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Platform dashboard summary (GET /api/v1/admin/platform-summary). Aggregated
 * counts only — no user PII is exposed. Status breakdown keys use the existing
 * §2 vocabularies (OperatorStatus / ReservationState / PaymentStatus).
 */
export interface PlatformSummary {
  users: number;
  operators: number;
  operatorsByStatus: Record<string, number>;
  facilities: number;
  facilitiesByStatus: Record<string, number>;
  activeFacilities: number;
  inactiveFacilities: number;
  parkingSlots: number;
  reservations: number;
  reservationsByStatus: Record<string, number>;
  payments: number;
  paymentsByStatus: Record<string, number>;
  recentAuditEventCount: number;
  recentAuditEvents: AuditEvent[];
}
