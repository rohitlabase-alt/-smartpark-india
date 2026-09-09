/**
 * SQL data access for payments + ledger transactions + payment idempotency
 * keys (docs/DATABASE.md §2.15/§2.16, docs/API_SPEC.md §6; migration 0006).
 */
import type { PoolClient } from "pg";
import type { Payment, PaymentStatus, PaymentTransactionKind } from "@smartpark/shared";
import { getPool } from "../../db.js";

export interface PaymentRow {
  id: number;
  reservationId: number;
  provider: "MOCK";
  providerTxnId: string | null;
  amount: number;
  status: PaymentStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface PaymentResult {
  id: string;
  reservation_id: string;
  provider: string;
  provider_txn_id: string | null;
  amount: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

function mapPayment(row: PaymentResult): PaymentRow {
  return {
    id: Number(row.id),
    reservationId: Number(row.reservation_id),
    provider: "MOCK",
    providerTxnId: row.provider_txn_id,
    amount: Number(row.amount),
    status: row.status as PaymentStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPaymentDto(row: PaymentRow): Payment {
  return {
    id: row.id,
    reservationId: row.reservationId,
    provider: row.provider,
    providerTxnId: row.providerTxnId,
    amount: row.amount,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SELECT_COLUMNS = `
  id, reservation_id, provider, provider_txn_id, amount, status, created_at, updated_at`;

export const paymentsRepository = {
  /** Latest payment for a reservation, or undefined. */
  async findLatestByReservation(reservationId: number): Promise<PaymentRow | undefined> {
    const { rows } = await getPool().query<PaymentResult>(
      `SELECT ${SELECT_COLUMNS} FROM payments
       WHERE reservation_id = $1
       ORDER BY id DESC LIMIT 1`,
      [reservationId],
    );
    return rows[0] ? mapPayment(rows[0]) : undefined;
  },

  /** A payment by provider txn id with the owning reservation's user, row-locked. */
  async findOwnedByProviderTxnId(
    client: PoolClient,
    providerTxnId: string,
    userId: number,
  ): Promise<{ payment: PaymentRow; reservationUserId: number } | undefined> {
    const { rows } = await client.query<PaymentResult & { user_id: string }>(
      `SELECT p.*, r.user_id
       FROM payments p
       JOIN reservations r ON r.id = p.reservation_id
       WHERE p.provider_txn_id = $1 AND r.user_id = $2 AND r.deleted_at IS NULL
       FOR UPDATE OF p`,
      [providerTxnId, userId],
    );
    if (!rows[0]) return undefined;
    return { payment: mapPayment(rows[0]), reservationUserId: Number(rows[0].user_id) };
  },

  /** Creates a payment row for a reservation on the given transaction. */
  async create(
    client: PoolClient,
    input: {
      reservationId: number;
      provider: "MOCK";
      providerTxnId: string;
      amount: number;
      status: PaymentStatus;
    },
  ): Promise<PaymentRow> {
    const { rows } = await client.query<PaymentResult>(
      `INSERT INTO payments (reservation_id, provider, provider_txn_id, amount, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${SELECT_COLUMNS}`,
      [input.reservationId, input.provider, input.providerTxnId, input.amount, input.status],
    );
    return mapPayment(rows[0]!);
  },

  /** Updates a payment row on the given transaction. */
  async updateStatus(
    client: PoolClient,
    id: number,
    status: PaymentStatus,
  ): Promise<PaymentRow | undefined> {
    const { rows } = await client.query<PaymentResult>(
      `UPDATE payments SET status = $2, updated_at = now()
       WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [id, status],
    );
    return rows[0] ? mapPayment(rows[0]) : undefined;
  },

  /**
   * Inserts a ledger transaction row for a payment on the given transaction
   * (docs/DATABASE.md §2.16). Returns the id so it can be reused as the
   * subsequent transaction's reference.
   */
  async insertTransaction(
    client: PoolClient,
    input: {
      paymentId: number;
      kind: PaymentTransactionKind;
      amount: number;
      status: "SUCCESS" | "FAILED";
      reference?: string | null;
    },
  ): Promise<number> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO transactions (payment_id, kind, amount, status, reference)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [input.paymentId, input.kind, input.amount, input.status, input.reference ?? null],
    );
    return Number(rows[0]!.id);
  },

  /** Records a payment idempotency key (API_SPEC §6). */
  async claimIdempotencyKey(
    client: PoolClient,
    input: { userId: number; key: string; endpoint: string; paymentId: number },
  ): Promise<void> {
    await client.query(
      `INSERT INTO payment_idempotency_keys (user_id, key, endpoint, payment_id, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '15 minutes')`,
      [input.userId, input.key, input.endpoint, input.paymentId],
    );
  },

  /** Looks up the payment previously created for a (user, key, endpoint). */
  async findPaymentByKey(
    userId: number,
    key: string,
    endpoint: string,
  ): Promise<PaymentRow | undefined> {
    const { rows } = await getPool().query<PaymentResult>(
      `SELECT p.*
       FROM payment_idempotency_keys k
       JOIN payments p ON p.id = k.payment_id
       WHERE k.user_id = $1 AND k.key = $2 AND k.endpoint = $3
       AND k.expires_at > now()
       ORDER BY k.id DESC LIMIT 1`,
      [userId, key, endpoint],
    );
    return rows[0] ? mapPayment(rows[0]) : undefined;
  },
};
