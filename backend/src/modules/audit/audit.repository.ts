/**
 * SQL data access for the append-only audit trail (docs/DATABASE.md §2.23,
 * migration 0008). Audit rows are always written inside the calling business
 * transaction (`client` is required) so a mutation can never commit without
 * its audit record, and no application path updates or deletes audit rows.
 */
import type { PoolClient } from "pg";
import type { AuditEntityType, AuditEvent, AuditEventAction } from "@smartpark/shared";
import { getPool } from "../../db.js";

export interface AuditEventRow {
  id: number;
  actorUserId: number | null;
  actorEmail: string | null;
  action: AuditEventAction;
  entityType: AuditEntityType;
  entityId: number | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditEventResult {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: unknown;
  created_at: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mapAuditEvent(row: AuditEventResult): AuditEventRow {
  return {
    id: Number(row.id),
    actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id),
    actorEmail: row.actor_email,
    action: row.action as AuditEventAction,
    entityType: row.entity_type as AuditEntityType,
    entityId: row.entity_id === null ? null : Number(row.entity_id),
    metadata: isRecord(row.metadata) ? row.metadata : {},
    createdAt: row.created_at,
  };
}

export function toAuditEventDto(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface AuditListFilters {
  action?: string;
  entityType?: string;
  actorUserId?: number;
  entityId?: number;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export const auditRepository = {
  /**
   * Inserts an audit event on the given transaction (required: audit writes
   * always join the business transaction). actor identity is never zeroed or
   * taken from request bodies — callers pass the server-side session user id.
   */
  async create(
    client: PoolClient,
    input: {
      actorUserId: number | null;
      action: AuditEventAction;
      entityType: AuditEntityType;
      entityId?: number | null;
      metadata: Record<string, unknown>;
    },
  ): Promise<AuditEventRow> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id`,
      [
        input.actorUserId,
        input.action,
        input.entityType,
        input.entityId ?? null,
        JSON.stringify(input.metadata),
      ],
    );
    return {
      id: Number(rows[0]!.id),
      actorUserId: input.actorUserId,
      actorEmail: null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata,
      createdAt: new Date(),
    };
  },

  /**
   * Lists audit events, newest first with an id tie-break for total
   * determinism across identical timestamps. `total` reflects the filters
   * (used for pagination). Actor email is joined from users for the admin UI.
   */
  async list(filters: AuditListFilters): Promise<{ events: AuditEventRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, operator: string, value: unknown) => {
      params.push(value);
      conditions.push(`${column} ${operator} $${params.length}`);
    };

    if (filters.action) push("a.action", "=", filters.action);
    if (filters.entityType) push("a.entity_type", "=", filters.entityType);
    if (filters.actorUserId !== undefined) push("a.actor_user_id", "=", filters.actorUserId);
    if (filters.entityId !== undefined) push("a.entity_id", "=", filters.entityId);
    if (filters.from) push("a.created_at", ">=", filters.from);
    if (filters.to) push("a.created_at", "<=", filters.to);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows: countRows } = await getPool().query<{ total: string }>(
      `SELECT count(*) AS total FROM audit_events a ${where}`,
      params,
    );
    const total = Number(countRows[0]!.total);

    const listParams = [...params, filters.limit, filters.offset];
    const { rows } = await getPool().query<AuditEventResult>(
      `SELECT a.id, a.actor_user_id, a.action, a.entity_type, a.entity_id,
              a.metadata, a.created_at, u.email AS actor_email
       FROM audit_events a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );
    return { events: rows.map(mapAuditEvent), total };
  },

  /** Total number of audit events (platform summary). */
  async countAll(): Promise<number> {
    const { rows } = await getPool().query<{ total: string }>(
      "SELECT count(*) AS total FROM audit_events",
    );
    return Number(rows[0]!.total);
  },
};
