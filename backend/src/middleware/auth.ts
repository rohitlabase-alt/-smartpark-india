/**
 * requireAuth: resolves the Bearer JWT to a live, ACTIVE user and attaches
 * { userId, roles, status } to the request. Roles/status are re-read from the
 * database on every request so suspensions and role changes apply immediately.
 */
import type { NextFunction, Request, Response } from "express";
import type { UserRoleCode } from "@smartpark/shared";
import { asyncHandler } from "../http/async-handler.js";
import { forbidden, unauthorized } from "../http/errors.js";
import type { AuthenticatedRequest } from "../http/context.js";
import { authRepository } from "../modules/auth/auth.repository.js";
import { verifyAccessToken } from "../modules/auth/tokens.js";

export function requireAuth() {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw unauthorized("UNAUTHORIZED", "Missing bearer token");
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      throw unauthorized("UNAUTHORIZED", "Missing bearer token");
    }

    const userId = await verifyAccessToken(token);
    const user = await authRepository.findById(userId);
    if (!user) {
      throw unauthorized("UNKNOWN_USER", "Account no longer exists");
    }
    if (user.status !== "ACTIVE") {
      throw forbidden("ACCOUNT_INACTIVE", "Account is suspended or not active");
    }

    const roles = await authRepository.getRoles(userId);
    (req as AuthenticatedRequest).auth = { userId, roles, status: user.status };
    next();
  });
}

/**
 * requireRole: must run after requireAuth(). Enforces RBAC server-side by
 * rejecting authenticated requests whose roles do not intersect the allowed
 * set (docs/API_SPEC.md §6). 403 for insufficient privileges.
 */
export function requireRole(...allowed: UserRoleCode[]) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const auth = (req as AuthenticatedRequest).auth;
    if (!auth) {
      throw unauthorized("UNAUTHORIZED", "Authentication required");
    }
    const granted = auth.roles.some((role) => allowed.includes(role));
    if (!granted) {
      throw forbidden("FORBIDDEN", "Insufficient role for this operation");
    }
    next();
  });
}
