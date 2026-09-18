import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  type AuditEvent,
  type AuditEventAction,
  type AuditEntityType,
  type AuditEventListResponse,
} from "@smartpark/shared";
import { listAuditEvents } from "./api/admin";
import { AuthApiError } from "./api/auth";

type LoadState = "loading" | "success" | "error";

export const ADMIN_ACTION_LABELS: Record<AuditEventAction, string> = {
  OPERATOR_REVIEWED: "Operator reviewed",
  OPERATOR_APPROVED: "Operator approved",
  OPERATOR_REJECTED: "Operator rejected",
  OPERATOR_REGISTERED: "Operator registered",
  FACILITY_REVIEWED: "Facility reviewed",
  FACILITY_APPROVED: "Facility approved",
  FACILITY_REJECTED: "Facility rejected",
  FACILITY_ACTIVATED: "Facility activated",
  FACILITY_DEACTIVATED: "Facility deactivated",
  FACILITY_CREATED: "Facility created",
  FACILITY_UPDATED: "Facility updated",
  SLOT_CREATED: "Slot created",
  SLOT_UPDATED: "Slot updated",
  RESERVATION_CREATED: "Reservation created",
  RESERVATION_CANCELLED: "Reservation cancelled",
  PAYMENT_INITIATED: "Payment initiated",
  PAYMENT_VERIFIED: "Payment verified",
  PARKING_SESSION_ENTRY: "Parking entry",
  PARKING_SESSION_EXIT: "Parking exit",
  PARKING_SESSION_CANCELLED: "Parking session cancelled",
  GATE_ENTRY_VERIFIED: "Gate entry verified",
  GATE_ENTRY_REJECTED: "Gate entry rejected",
  GATE_EXIT_VERIFIED: "Gate exit verified",
  GATE_EXIT_REJECTED: "Gate exit rejected",
  SLOT_OCCUPIED: "Slot occupied",
  SLOT_RELEASED: "Slot released",
};

const PAGE_LIMIT_OPTIONS = [10, 20, 50];

interface AdminAuditProps {
  accessToken: string;
  onError?: (message: string) => void;
}

function label(value: string): string {
  return value.replace(/[-_]/g, " ").toLowerCase();
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function actorLabel(event: AuditEvent, fallback: string): string {
  if (event.actorEmail) return event.actorEmail;
  if (event.actorUserId === null) return fallback;
  return `User #${event.actorUserId}`;
}

function auditErrorMessage(cause: unknown): string {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401)
      return "Your admin session is no longer authorized. Please sign in again.";
    if (cause.status === 403) return "Only administrators can view the audit trail.";
    return cause.message;
  }
  return cause instanceof Error ? cause.message : "Unable to load audit events.";
}

export default function AdminAudit({ accessToken, onError }: AdminAuditProps) {
  const [events, setEvents] = useState<AuditEventListResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");

  const [actionFilter, setActionFilter] = useState<AuditEventAction | "">("");
  const [entityFilter, setEntityFilter] = useState<AuditEntityType | "">("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [appliedFilters, setAppliedFilters] = useState<{
    action: AuditEventAction | "";
    entityType: AuditEntityType | "";
    from: string;
    to: string;
  }>({ action: "", entityType: "", from: "", to: "" });

  const requestId = useRef(0);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const load = useCallback(
    async (token: string, filters: typeof appliedFilters): Promise<void> => {
      const id = ++requestId.current;
      setLoadState("loading");
      setError("");
      try {
        const result = await listAuditEvents(token, {
          action: filters.action || undefined,
          entityType: filters.entityType || undefined,
          from: filters.from ? `${filters.from}T00:00:00.000Z` : undefined,
          to: filters.to ? `${filters.to}T23:59:59.999Z` : undefined,
          page,
          limit,
        });
        if (id !== requestId.current) return;
        setEvents(result);
        setLoadState("success");
      } catch (cause) {
        if (id !== requestId.current) return;
        const message = auditErrorMessage(cause);
        setLoadState("error");
        setError(message);
        onErrorRef.current?.(message);
      }
    },
    [page, limit],
  );

  useEffect(() => {
    void load(accessToken, appliedFilters);
    return () => {
      requestId.current += 1;
    };
  }, [accessToken, load, appliedFilters]);

  function applyFilters(nextPage = 1): void {
    setPage(nextPage);
    setAppliedFilters({
      action: actionFilter,
      entityType: entityFilter,
      from: fromFilter,
      to: toFilter,
    });
  }

  const totalPages = events ? Math.max(1, Math.ceil(events.total / events.limit)) : 1;
  const startIndex = events && events.events.length > 0 ? (events.page - 1) * events.limit + 1 : 0;
  const endIndex = events && events.events.length > 0 ? startIndex + events.events.length - 1 : 0;

  return (
    <section className="platform-audit" aria-labelledby="admin-audit-title">
      <div className="admin-platform-title-row">
        <h3 id="admin-audit-title">Audit Trail</h3>
        <button
          type="button"
          className="platform-refresh-button"
          onClick={() => void load(accessToken, appliedFilters)}
        >
          Refresh
        </button>
        <span className="reservation-count">
          {events ? `${events.total} event${events.total === 1 ? "" : "s"}` : "loading..."}
        </span>
      </div>

      <div className="audit-filters">
        <label>
          <span className="audit-filter-label">Action</span>
          <select
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value as AuditEventAction | "")}
          >
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {ADMIN_ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="audit-filter-label">Entity</span>
          <select
            value={entityFilter}
            onChange={(event) => setEntityFilter(event.target.value as AuditEntityType | "")}
          >
            <option value="">All entities</option>
            {AUDIT_ENTITY_TYPES.map((entity) => (
              <option key={entity} value={entity}>
                {label(entity)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="audit-filter-label">From</span>
          <input
            type="date"
            value={fromFilter}
            max={toFilter || undefined}
            onChange={(event) => setFromFilter(event.target.value)}
          />
        </label>
        <label>
          <span className="audit-filter-label">To</span>
          <input
            type="date"
            value={toFilter}
            min={fromFilter || undefined}
            onChange={(event) => setToFilter(event.target.value)}
          />
        </label>
        <button type="button" className="audit-apply-button" onClick={() => applyFilters()}>
          Apply filters
        </button>
      </div>

      <div className="admin-status-region" aria-live="polite" aria-busy={loadState === "loading"}>
        {loadState === "loading" && <p className="notice">Loading audit events...</p>}
        {loadState === "error" && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {loadState === "success" && events && events.events.length === 0 && (
          <p className="empty-state">No audit events match these filters.</p>
        )}
        {loadState === "success" && events && events.events.length > 0 && (
          <>
            <ul className="audit-event-list">
              {events.events.map((event) => (
                <li className="audit-event-item" key={event.id}>
                  <div className="audit-event-heading">
                    <strong>{ADMIN_ACTION_LABELS[event.action]}</strong>
                    <span className="reservation-status state-verified">
                      {label(event.entityType)}
                    </span>
                  </div>
                  <dl className="admin-operator-details audit-event-details">
                    <div>
                      <dt>Actor</dt>
                      <dd>{actorLabel(event, "System")}</dd>
                    </div>
                    <div>
                      <dt>Entity ID</dt>
                      <dd>{event.entityId === null ? "—" : `#${event.entityId}`}</dd>
                    </div>
                    <div>
                      <dt>Action</dt>
                      <dd>{event.action}</dd>
                    </div>
                    <div>
                      <dt>When</dt>
                      <dd>
                        <time dateTime={event.createdAt}>{formatTimestamp(event.createdAt)}</time>
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            <div className="audit-pagination">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span className="audit-pagination-info">
                Page {events.page} of {totalPages} · {startIndex}–{endIndex} of {events.total}
              </span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </button>
              <label className="audit-limit-label">
                Per page
                <select
                  value={limit}
                  onChange={(event) => {
                    setLimit(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  {PAGE_LIMIT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
