/**
 * Auth application logic: register / login / refresh / logout / me
 * (docs/API_SPEC.md §2 auth, docs/SECURITY.md §6).
 */
import type { PublicUser, RegisterRequest, AuthResponse } from "@smartpark/shared";
import { config } from "../../config.js";
import { unauthorized } from "../../http/errors.js";
import { authRepository, insertRefreshToken, mapUniqueEmailViolation } from "./auth.repository.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  accessTokenTtlSeconds,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from "./tokens.js";
import { withTransaction } from "../../db.js";

export const authService = {
  async register(input: RegisterRequest): Promise<AuthResponse> {
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const refreshTokenExpiresAt = new Date(Date.now() + config.auth.refreshTokenTtlSeconds * 1000);

    let userId!: number;
    try {
      const result = await authRepository.createUser({
        email: input.email.trim().toLowerCase(),
        passwordHash: await hashPassword(input.password),
        fullName: input.fullName ?? null,
        phone: input.phone ?? null,
        locale: "en",
        role: "USER",
        refreshTokenHash,
        refreshTokenExpiresAt,
      });
      userId = result.userId;
    } catch (err) {
      mapUniqueEmailViolation(err);
    }

    return this.issueSession(userId, refreshToken);
  },

  async login(email: string, password: string): Promise<AuthResponse> {
    const user = await authRepository.findByEmail(email.trim().toLowerCase());
    // Indistinguishable response for unknown email vs wrong password
    // (docs/SECURITY.md: no account enumeration via login errors).
    if (!user) {
      throw unauthorized("INVALID_CREDENTIALS", "Invalid email or password");
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      throw unauthorized("INVALID_CREDENTIALS", "Invalid email or password");
    }
    if (user.status !== "ACTIVE") {
      throw unauthorized("ACCOUNT_INACTIVE", "Account is not active");
    }

    await authRepository.setLastLogin(user.id);

    const refreshToken = generateRefreshToken();
    await withTransaction(async (client) => {
      await insertRefreshToken(
        client,
        user.id,
        hashRefreshToken(refreshToken),
        new Date(Date.now() + config.auth.refreshTokenTtlSeconds * 1000),
      );
    });

    return this.issueSession(user.id, refreshToken);
  },

  async refresh(rawRefreshToken: string): Promise<AuthResponse> {
    const found = await authRepository.findRefreshToken(hashRefreshToken(rawRefreshToken));
    if (!found || found.revoked_at || found.replaced_at || found.user_deleted_at) {
      throw unauthorized("REFRESH_TOKEN_INVALID", "Invalid or revoked refresh token");
    }
    if (found.expires_at.getTime() <= Date.now()) {
      throw unauthorized("REFRESH_TOKEN_EXPIRED", "Refresh token has expired");
    }
    if (found.user_status !== "ACTIVE") {
      throw unauthorized("ACCOUNT_INACTIVE", "Account is not active");
    }

    const newRefreshToken = generateRefreshToken();
    await authRepository.rotateRefreshToken({
      oldTokenId: Number(found.id),
      userId: Number(found.user_id),
      newTokenHash: hashRefreshToken(newRefreshToken),
      expiresAt: new Date(Date.now() + config.auth.refreshTokenTtlSeconds * 1000),
    });

    return this.issueSession(Number(found.user_id), newRefreshToken);
  },

  async logout(userId: number, rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    const found = await authRepository.findRefreshToken(hashRefreshToken(rawRefreshToken));
    if (found && Number(found.user_id) === userId) {
      await authRepository.revokeRefreshToken(Number(found.id));
    }
  },

  async me(userId: number): Promise<PublicUser> {
    const profile = await authRepository.getProfile(userId);
    if (!profile) {
      throw unauthorized("UNKNOWN_USER", "Account no longer exists");
    }
    return profile;
  },

  async issueSession(userId: number, refreshToken: string): Promise<AuthResponse> {
    const accessToken = await signAccessToken(userId);
    const user = await authRepository.getProfile(userId);
    if (!user) {
      throw unauthorized("UNKNOWN_USER", "Account no longer exists");
    }
    return {
      accessToken,
      refreshToken,
      expiresInSeconds: accessTokenTtlSeconds(),
      user,
    };
  },
};
