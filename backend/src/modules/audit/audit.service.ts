/**
 * Audit application logic (Phase 8, Part 4; docs/DATABASE.md §2.23,
 * docs/SECURITY.md §5). Responsible for the audit write boundary: validating
 * that only known action/entity vocabularies are used and sanitizing metadata
 * so credentials/tokens/secrets are never persisted. Not a generic event bus —
 * callers are explicit, typed service integration points.
 */
import type { PoolClient } from "pg";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  type AuditEntityType,
  type AuditEventAction,
  type AuditEventFilters,
  type AuditEventListResponse,
} from "@smartpark/shared";
import { badRequest } from "../../http/errors.js";
import { auditRepository, toAuditEventDto, type AuditEventRow } from "./audit.repository.js";

const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|credential|authorization|api[_-]?key|private[_-]?key|otp|cvv|pin|signature/i;

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

export function isAuditAction(value: string): value is AuditEventAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

export function isAuditEntityType(value: string): value is AuditEntityType {
  return (AUDIT_ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * Returns only JSON-safe scalars, scalar arrays, null and nested plain
 * objects. Any key whose name looks like a credential is dropped (recursively);
 * arrays/unknown object types are never written.
 */
export function sanitizeMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY_PATTERN.test(key.replace(/_/g, ""))) continue;
    if (value === null) {
      clean[key] = null;
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      clean[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      const items = value.filter(
        (item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean",
      );
      if (items.length > 0) clean[key] = items;
      continue;
    }
    if (typeof value === "object") {
      const nested = sanitizeMetadata(value);
      if (Object.keys(nested).length > 0) clean[key] = nested;
    }
  }
  return clean;
}

export const auditService = {
  /**
   * Validates the action/entity vocabulary and sanitizes metadata before the
   * repository insert. Runs on the caller's transaction client so the audit
   * record commits atomically with the business mutation.
   */
  async createEvent(
    client: PoolClient,
    input: {
      actorUserId: number | null;
      action: AuditEventAction;
      entityType: AuditEntityType;
      entityId?: number | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<AuditEventRow> {
    if (!isAuditAction(input.action)) {
      throw badRequest("INVALID_AUDIT_ACTION", `Unknown audit action: ${input.action}`);
    }
    if (!isAuditEntityType(input.entityType)) {
      throw badRequest("INVALID_AUDIT_ENTITY", `Unknown audit entity type: ${input.entityType}`);
    }
    return auditRepository.create(client, {
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: sanitizeMetadata(input.metadata),
    });
  },

  /** Validates filter values and returns a deterministic, pageable list. */
  async listEvents(filters: AuditEventFilters): Promise<AuditEventListResponse> {
    const page = filters.page ?? 1;
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
    const offset = (page - 1) * limit;

    const { events, total } = await auditRepository.list({
      action: filters.action,
      entityType: filters.entityType,
      actorUserId: filters.actorUserId,
      entityId: filters.entityId,
      from: filters.from,
      to: filters.to,
      limit,
      offset,
    });
    return { events: events.map(toAuditEventDto), page, limit, total };
  },
};
