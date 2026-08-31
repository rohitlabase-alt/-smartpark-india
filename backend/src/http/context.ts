import type { Request } from "express";
import type { UserRoleCode, UserStatus } from "@smartpark/shared";

/**
 * Identity resolved by the auth middleware for the current request.
 * Roles are always re-read from the database so role changes and account
 * suspensions take effect immediately (not just when a token next expires).
 */
export interface AuthContext {
  userId: number;
  roles: UserRoleCode[];
  status: UserStatus;
}

/** Express request guaranteed to carry an authenticated identity. */
export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
}
