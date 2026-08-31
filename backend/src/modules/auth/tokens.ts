/**
 * Session token primitives (docs/SECURITY.md §6, docs/API_SPEC.md §6).
 *
 * - Access token: short-lived JWT (HS256, alg pinned), minimal payload
 *   (subject only), + iss/aud/iat/exp claims. Key material comes exclusively
 *   from the JWT_SECRET environment variable — the API fails closed when it
 *   is unset.
 * - Refresh token: cryptographically random opaque string; only its SHA-256
 *   digest is stored at rest (a DB leak does not expose usable tokens).
 */
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { API_NAMESPACE } from "@smartpark/shared";
import { config } from "../../config.js";
import { HttpError, unauthorized } from "../../http/errors.js";

function jwtKey(): Uint8Array {
  if (!config.auth.jwtSecret) {
    throw new HttpError(500, "AUTH_CONFIG_ERROR", "JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(config.auth.jwtSecret);
}

export async function signAccessToken(userId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(String(userId))
    .setIssuer(config.auth.issuer)
    .setAudience(config.auth.audience ?? API_NAMESPACE)
    .setIssuedAt()
    .setExpirationTime(`${config.auth.jwtExpiresInSeconds}s`)
    .sign(jwtKey());
}

/** Returns the subject (user id) for a valid access token, else 401. */
export async function verifyAccessToken(token: string): Promise<number> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwtKey(), {
      algorithms: ["HS256"],
      issuer: config.auth.issuer,
      audience: config.auth.audience ?? API_NAMESPACE,
    }));
  } catch {
    throw unauthorized("INVALID_TOKEN", "Invalid or expired access token");
  }
  if (!payload.sub || !/^\d+$/.test(payload.sub)) {
    throw unauthorized("INVALID_TOKEN", "Invalid or expired access token");
  }
  return Number(payload.sub);
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function accessTokenTtlSeconds(): number {
  return config.auth.jwtExpiresInSeconds;
}
