/**
 * SQL data access for operator organisations (docs/DATABASE.md §2.4).
 * One operator org per owner user (UNIQUE owner_user_id) — /operators/me
 * semantics in docs/API_SPEC.md assume this.
 */
import type { Operator, OperatorStatus } from "@smartpark/shared";
import type { PoolClient } from "pg";
import { getPool } from "../../db.js";
import { conflict } from "../../http/errors.js";

export interface OperatorRow {
  id: number;
  name: string;
  businessType: string | null;
  registrationNumber: string | null;
  verificationStatus: OperatorStatus;
  createdAt: string;
}

interface OperatorResult {
  id: string;
  name: string;
  business_type: string | null;
  registration_number: string | null;
  verification_status: string;
  created_at: Date;
}

function mapOperator(row: OperatorResult): OperatorRow {
  return {
    id: Number(row.id),
    name: row.name,
    businessType: row.business_type,
    registrationNumber: row.registration_number,
    verificationStatus: row.verification_status as OperatorStatus,
    createdAt: row.created_at.toISOString(),
  };
}

export function toOperatorDto(row: OperatorRow): Operator {
  return {
    id: row.id,
    name: row.name,
    businessType: row.businessType,
    registrationNumber: row.registrationNumber,
    verificationStatus: row.verificationStatus,
    createdAt: row.createdAt,
  };
}

export const operatorsRepository = {
  /** Inserts the operator row; runs on the given client (or its own) so it can join a caller's transaction. */
  async create(
    input: {
      ownerUserId: number;
      name: string;
      businessType: string | null;
      registrationNumber: string | null;
    },
    client?: PoolClient,
  ): Promise<OperatorRow> {
    const target = client ?? getPool();
    try {
      const { rows } = await target.query<OperatorResult>(
        `INSERT INTO operators (owner_user_id, name, business_type, registration_number, verification_status)
         VALUES ($1, $2, $3, $4, 'PENDING')
         RETURNING id, name, business_type, registration_number, verification_status, created_at`,
        [input.ownerUserId, input.name, input.businessType, input.registrationNumber],
      );
      return mapOperator(rows[0]!);
    } catch (err) {
      if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
        throw conflict("OPERATOR_EXISTS", "This account already owns a parking operator");
      }
      throw err;
    }
  },

  async findByOwnerUser(ownerUserId: number): Promise<OperatorRow | undefined> {
    const { rows } = await getPool().query<OperatorResult>(
      `SELECT id, name, business_type, registration_number, verification_status, created_at
       FROM operators WHERE owner_user_id = $1 AND deleted_at IS NULL`,
      [ownerUserId],
    );
    return rows[0] ? mapOperator(rows[0]) : undefined;
  },

  async findById(id: number): Promise<OperatorRow | undefined> {
    const { rows } = await getPool().query<OperatorResult>(
      `SELECT id, name, business_type, registration_number, verification_status, created_at
       FROM operators WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? mapOperator(rows[0]) : undefined;
  },
};
