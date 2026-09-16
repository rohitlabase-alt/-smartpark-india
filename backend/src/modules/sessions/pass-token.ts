/**
 * Parking-pass verification tokens (Phase 9 Block 3; docs/API_SPEC.md §2
 * parking-sessions, docs/SECURITY.md, docs/DECISIONS.md D-038).
 *
 * A parking pass is a deterministic JWT (HS256, alg pinned) that encodes a
 * confirmed reservation's entry credential:
 *
 *   ppk_<signed JWT>
 *
 * Claims (deliberately minimal, no PII):
 *   - sub   = reservationCode (a BKG-… booking reference, never a DB id)
 *   - scope = "parking:entry"
 *   - exp   = reservation.endsAt (seconds since epoch)
 *   - NO ia t: the token is byte-deterministic for a given reservation +
 *     window, so the same pass can be re-derived on reload without regrowth,
 *     stored (as a hash) once, and never "regenerated" into a new value.
 *
 * The raw token is NEVER persisted or logged; only its SHA-256 digest is
 * stored on the reservation (reservations.verification_token_hash). Because
 * the token is deterministic, verification of a token whose stored hash is
 * missing (pre-migration confirmations) can safely backfill that hash on
 * first presentation.
 */
import { createHash } from "node:crypto";
import { errors, SignJWT, jwtVerify } from "jose";
import { config } from "../../config.js";
import { conflict, HttpError } from "../../http/errors.js";

const PASS_SCOPE = "parking:entry";
const PASS_AUDIENCE = "smartpark:parking-pass";
export const PASS_TOKEN_PREFIX = "ppk_";

function passKey(): Uint8Array {
  if (!config.auth.jwtSecret) {
    throw new HttpError(500, "AUTH_CONFIG_ERROR", "JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(config.auth.jwtSecret);
}

function assertReservationCode(code: string): void {
  if (!/^BKG-[0-9A-F]{12}$/.test(code)) {
    throw conflict("INVALID_TOKEN", "This parking pass is invalid");
  }
}

/**
 * Signs a deterministic parking-pass token for a reservation window. The same
 * (code, endsAt) pair always yields the exact same bytes — no iat, no random
 * component — so the pass is stable across reloads and re-derivations.
 */
export async function signParkingPassToken(reservationCode: string, endsAt: Date): Promise<string> {
  assertReservationCode(reservationCode);
  const token = await new SignJWT({ scope: PASS_SCOPE })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(reservationCode)
    .setIssuer(config.auth.issuer)
    .setAudience(PASS_AUDIENCE)
    .setExpirationTime(Math.floor(endsAt.getTime() / 1000))
    .sign(passKey());
  return `${PASS_TOKEN_PREFIX}${token}`;
}

/**
 * Verifies a parking-pass token: signature, algorithm pin, issuer/audience,
 * scope and subject, and expiry. Returns the reservation code on success.
 *
 * Error contract (no existence disclosure): a token that fails any claim is a
 * deterministic 409 INVALID_TOKEN/TOKEN_EXPIRED — callers must NEVER fall back
 * to "does this reservation exist?" behavior based on a bad signature.
 */
export async function verifyParkingPassToken(token: string): Promise<{ reservationCode: string }> {
  if (!token.startsWith(PASS_TOKEN_PREFIX)) {
    throw conflict("INVALID_TOKEN", "This parking pass is invalid");
  }
  const compact = token.slice(PASS_TOKEN_PREFIX.length);
  let payload;
  try {
    ({ payload } = await jwtVerify(compact, passKey(), {
      algorithms: ["HS256"],
      issuer: config.auth.issuer,
      audience: PASS_AUDIENCE,
    }));
  } catch (err) {
    if (err instanceof errors.JWTExpired) {
      throw conflict("TOKEN_EXPIRED", "This parking pass has expired");
    }
    throw conflict("INVALID_TOKEN", "This parking pass is invalid");
  }
  if (payload.scope !== PASS_SCOPE || typeof payload.sub !== "string") {
    throw conflict("INVALID_TOKEN", "This parking pass is invalid");
  }
  assertReservationCode(payload.sub);
  return { reservationCode: payload.sub };
}

/** SHA-256 digest of the raw pass token — the only at-rest representation. */
export function hashParkingPassToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
