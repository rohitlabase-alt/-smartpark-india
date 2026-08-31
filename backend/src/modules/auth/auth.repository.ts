/**
 * SQL data access for users, roles and refresh tokens (Phase 2A auth
 * foundation). All reads filter `deleted_at IS NULL` (soft-delete
 * convention, docs/DATABASE.md §3). NUMERIC/BIGINT columns arrive from
 * node-postgres as strings and are normalized here.
 */
import type { PoolClient } from "pg";
import type { PublicUser, UserRoleCode, UserStatus } from "@smartpark/shared";
import { getPool, withTransaction } from "../../db.js";
import { conflict } from "../../http/errors.js";

export interface UserRow {
  id: number;
  email: string;
  passwordHash: string;
  fullName: string | null;
  phone: string | null;
  locale: string;
  status: UserStatus;
  createdAt: string;
  deletedAt: Date | null;
}

interface UserResult {
  id: string;
  email: string;
  password_hash: string;
  full_name: string | null;
  phone: string | null;
  locale: string;
  status: string;
  created_at: Date;
  deleted_at: Date | null;
}

function mapUser(row: UserResult): UserRow {
  return {
    id: Number(row.id),
    email: row.email,
    passwordHash: row.password_hash,
    fullName: row.full_name,
    phone: row.phone,
    locale: row.locale,
    status: row.status as UserStatus,
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at,
  };
}

/**
 * Re-raises a postgres unique-violation (SQLSTATE 23505) as a 409 so callers
 * get API_SPEC-compliant errors; rethrows anything else unchanged.
 */
export function mapUniqueEmailViolation(err: unknown): never {
  if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
    const constraint = (err as { constraint?: string }).constraint;
    if (constraint === "users_email_idx") {
      throw conflict("DUPLICATE_EMAIL", "Email already registered");
    }
    if (constraint === "users_phone_idx") {
      throw conflict("DUPLICATE_PHONE", "Phone number already registered");
    }
    throw conflict("CONFLICT", "A related record already exists");
  }
  throw err;
}

export const authRepository = {
  /** Creates a user + default role + first refresh token atomically. */
  async createUser(input: {
    email: string;
    passwordHash: string;
    fullName: string | null;
    phone: string | null;
    locale: string;
    role: UserRoleCode;
    refreshTokenHash: string;
    refreshTokenExpiresAt: Date;
  }): Promise<{ userId: number }> {
    return withTransaction(async (client) => {
      const { rows } = await client.query<UserResult>(
        `INSERT INTO users (email, password_hash, full_name, phone, locale, status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
         RETURNING id, email, password_hash, full_name, phone, locale, status, created_at, deleted_at`,
        [input.email, input.passwordHash, input.fullName, input.phone, input.locale],
      );
      const userId = Number(rows[0]!.id);
      await assignRole(userId, input.role, client);
      await insertRefreshToken(client, userId, input.refreshTokenHash, input.refreshTokenExpiresAt);
      return { userId };
    });
  },

  async findByEmail(email: string): Promise<UserRow | undefined> {
    const { rows } = await getPool().query<UserResult>(
      `SELECT id, email, password_hash, full_name, phone, locale, status, created_at, deleted_at
       FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email],
    );
    return rows[0] ? mapUser(rows[0]) : undefined;
  },

  async findById(id: number): Promise<UserRow | undefined> {
    const { rows } = await getPool().query<UserResult>(
      `SELECT id, email, password_hash, full_name, phone, locale, status, created_at, deleted_at
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? mapUser(rows[0]) : undefined;
  },

  async getRoles(userId: number): Promise<UserRoleCode[]> {
    const { rows } = await getPool().query<{ code: string }>(
      `SELECT r.code FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1
       ORDER BY r.code`,
      [userId],
    );
    return rows.map((r) => r.code as UserRoleCode);
  },

  async getProfile(userId: number): Promise<PublicUser | undefined> {
    const user = await this.findById(userId);
    if (!user) return undefined;
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      locale: user.locale,
      status: user.status,
      roles: await this.getRoles(userId),
      createdAt: user.createdAt,
    };
  },

  async setLastLogin(userId: number): Promise<void> {
    await getPool().query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
  },

  async findRefreshToken(tokenHash: string) {
    const { rows } = await getPool().query(
      `SELECT rt.id, rt.token_hash, rt.expires_at, rt.revoked_at, rt.replaced_at,
              u.id AS user_id, u.status AS user_status, u.deleted_at AS user_deleted_at
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash],
    );
    return rows[0] as
      | {
          id: string;
          token_hash: string;
          expires_at: Date;
          revoked_at: Date | null;
          replaced_at: Date | null;
          user_id: string;
          user_status: string;
          user_deleted_at: Date | null;
        }
      | undefined;
  },

  /**
   * Rotation: marks the old refresh token revoked/replaced and inserts the new
   * one atomically. A used (already revoked) token can never be replayed
   * (docs/SECURITY.md §6).
   */
  async rotateRefreshToken(input: {
    oldTokenId: number;
    userId: number;
    newTokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    return withTransaction(async (client) => {
      await client.query(
        "UPDATE refresh_tokens SET revoked_at = now(), replaced_at = now() WHERE id = $1",
        [input.oldTokenId],
      );
      await insertRefreshToken(client, input.userId, input.newTokenHash, input.expiresAt);
    });
  },

  async revokeRefreshToken(id: number): Promise<void> {
    await getPool().query(
      "UPDATE refresh_tokens SET revoked_at = now(), replaced_at = now() WHERE id = $1",
      [id],
    );
  },
};

export async function insertRefreshToken(
  client: PoolClient,
  userId: number,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await client.query(
    "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, tokenHash, expiresAt],
  );
}

export async function assignRole(
  userId: number,
  roleCode: UserRoleCode,
  client?: PoolClient,
): Promise<void> {
  const target = client ?? getPool();
  await target.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE code = $2
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, roleCode],
  );
}
