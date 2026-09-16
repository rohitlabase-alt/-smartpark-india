import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  type AuditEventAction,
  type AuditEntityType,
  type AuditEvent,
  type AuditEventListResponse,
  type PlatformSummary,
} from "@smartpark/shared";
import { getPlatformSummary, listAuditEvents } from "./api/admin";
import { AuthApiError } from "./api/auth";

type LoadState = "loading" | "success" | "error";

const ACTION_LABELS: Record<AuditEventAction, string> = {
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
  GATE_ENTRY_VERIFIED: "Gate entry verified",
  GATE_ENTRY_REJECTED: "Gate entry rejected",
  GATE_EXIT_VERIFIED: "Gate exit verified",
  GATE_EXIT_REJECTED: "Gate exit rejected",
  SLOT_OCCUPIED: "Slot occupied",
  SLOT_RELEASED: "Slot released",
};

const PAGE_LIMIT_OPTIONS = [10, 20, 50];

interface AdminPlatformProps {
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

function platformErrorMessage(cause: unknown, operation: "load" | "action"): string {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401)
      return "Your admin session is no longer authorized. Please sign in again.";
    if (cause.status === 403) return "Only administrators can view platform analytics.";
    return cause.message;
  }
  return cause instanceof Error
    ? cause.message
    : operation === "action"
      ? "Unable to refresh the platform dashboard. Try again."
      : "Unable to load platform analytics.";
}

export default function AdminPlatform({ accessToken, onError }: AdminPlatformProps) {
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [summaryLoadState, setSummaryLoadState] = useState<LoadState>("loading");
  const [summaryError, setSummaryError] = useState("");

  const [events, setEvents] = useState<AuditEventListResponse | null>(null);
  const [eventsLoadState, setEventsLoadState] = useState<LoadState>("loading");
  const [eventsError, setEventsError] = useState("");

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

  const summaryRequestId = useRef(0);
  const eventsRequestId = useRef(0);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const loadSummary = useCallback(async (token: string): Promise<void> => {
    const requestId = ++summaryRequestId.current;
    setSummaryLoadState("loading");
    setSummaryError("");
    try {
      const result = await getPlatformSummary(token);
      if (requestId !== summaryRequestId.current) return;
      setSummary(result);
      setSummaryLoadState("success");
    } catch (cause) {
      if (requestId !== summaryRequestId.current) return;
      const message = platformErrorMessage(cause, "load");
      setSummaryLoadState("error");
      setSummaryError(message);
      onErrorRef.current?.(message);
    }
  }, []);

  const loadEvents = useCallback(
    async (token: string, filters: typeof appliedFilters): Promise<void> => {
      const requestId = ++eventsRequestId.current;
      setEventsLoadState("loading");
      setEventsError("");
      try {
        const result = await listAuditEvents(token, {
          action: filters.action || undefined,
          entityType: filters.entityType || undefined,
          from: filters.from ? `${filters.from}T00:00:00.000Z` : undefined,
          to: filters.to ? `${filters.to}T23:59:59.999Z` : undefined,
          page,
          limit,
        });
        if (requestId !== eventsRequestId.current) return;
        setEvents(result);
        setEventsLoadState("success");
      } catch (cause) {
        if (requestId !== eventsRequestId.current) return;
        const message = platformErrorMessage(cause, "load");
        setEventsLoadState("error");
        setEventsError(message);
        onErrorRef.current?.(message);
      }
    },
    [page, limit],
  );

  useEffect(
    () => () => {
      summaryRequestId.current += 1;
      eventsRequestId.current += 1;
    },
    [],
  );

  useEffect(() => {
    void loadSummary(accessToken);
  }, [accessToken, loadSummary]);

  useEffect(() => {
    void loadEvents(accessToken, appliedFilters);
  }, [accessToken, loadEvents, appliedFilters]);

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
    <div className="admin-platform" aria-labelledby="admin-platform-title">
      <div className="platform-summary">
        <div className="platform-summary-heading">
          <div className="admin-platform-title-row">
            <h3 id="admin-platform-title">Platform Overview</h3>
            <button
              type="button"
              className="platform-refresh-button"
              onClick={() => {
                void loadSummary(accessToken);
                void loadEvents(accessToken, appliedFilters);
              }}
            >
              Refresh
            </button>
          </div>
        </div>

        {summaryLoadState === "loading" && <p className="notice">Loading platform overview...</p>}
        {summaryLoadState === "error" && (
          <p className="notice error" role="alert">
            {summaryError}
          </p>
        )}
        {summaryLoadState === "success" && summary && (
          <>
            <div className="metrics" aria-label="Platform metrics">
              <div className="metric primary">
                <span>Admins &amp; users</span>
                <strong>{summary.users}</strong>
              </div>
              <div className="metric">
                <span>Operators</span>
                <strong>{summary.operators}</strong>
              </div>
              <div className="metric">
                <span>Facilities</span>
                <strong>{summary.facilities}</strong>
              </div>
              <div className="metric">
                <span>Parking slots</span>
                <strong>{summary.parkingSlots}</strong>
              </div>
              <div className="metric">
                <span>Reservations</span>
                <strong>{summary.reservations}</strong>
              </div>
              <div className="metric">
                <span>Payments</span>
                <strong>{summary.payments}</strong>
              </div>
              <div className="metric">
                <span>Active facilities</span>
                <strong>{summary.activeFacilities}</strong>
              </div>
              <div className="metric">
                <span>Inactive facilities</span>
                <strong>{summary.inactiveFacilities}</strong>
              </div>
              <div className="metric">
                <span>Active sessions</span>
                <strong>{summary.activeParkingSessions}</strong>
              </div>
              <div className="metric">
                <span>Slots occupied</span>
                <strong>{summary.occupiedSlots}</strong>
              </div>
              <div className="metric">
                <span>Slots available</span>
                <strong>{summary.availableSlots}</strong>
              </div>
            </div>

            <div className="platform-breakdowns">
              <BreakdownCard title="Operators by status" data={summary.operatorsByStatus} />
              <BreakdownCard title="Facilities by status" data={summary.facilitiesByStatus} />
              <BreakdownCard title="Reservations by state" data={summary.reservationsByStatus} />
              <BreakdownCard title="Payments by status" data={summary.paymentsByStatus} />
            </div>
          </>
        )}
      </div>

      <div className="platform-audit">
        <div className="admin-platform-title-row">
          <h3>Audit Trail</h3>
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
                  {ACTION_LABELS[action]}
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

        <div
          className="admin-status-region"
          aria-live="polite"
          aria-busy={eventsLoadState === "loading"}
        >
          {eventsLoadState === "loading" && <p className="notice">Loading audit events...</p>}
          {eventsLoadState === "error" && (
            <p className="notice error" role="alert">
              {eventsError}
            </p>
          )}
          {eventsLoadState === "success" && events && events.events.length === 0 && (
            <p className="empty-state">No audit events match these filters.</p>
          )}
          {eventsLoadState === "success" && events && events.events.length > 0 && (
            <>
              <ul className="audit-event-list">
                {events.events.map((event) => (
                  <li className="audit-event-item" key={event.id}>
                    <div className="audit-event-heading">
                      <strong>{ACTION_LABELS[event.action]}</strong>
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
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
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
      </div>
    </div>
  );
}

function BreakdownCard({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return (
    <div className="breakdown-card">
      <h4>{title}</h4>
      {total === 0 ? (
        <p className="empty-state">No records.</p>
      ) : (
        <ul className="breakdown-list">
          {entries.map(([status, count]) => (
            <li key={status}>
              <span className="breakdown-label">{label(status)}</span>
              <span className="breakdown-bar">
                <span
                  className="breakdown-bar-fill"
                  style={{ width: `${Math.round((count / total) * 100)}%` }}
                />
              </span>
              <span className="breakdown-count">{count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
