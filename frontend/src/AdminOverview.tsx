import { useCallback, useEffect, useRef, useState } from "react";
import { ADMIN_ACTION_LABELS } from "./AdminAudit";
import { getPlatformSummary } from "./api/admin";
import { AuthApiError } from "./api/auth";
import type { PlatformSummary } from "@smartpark/shared";

type LoadState = "loading" | "success" | "error";

interface AdminOverviewProps {
  accessToken: string;
  onNavigate: (section: "operators" | "facilities" | "audit") => void;
  onError?: (message: string) => void;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function label(value: string): string {
  return value.replace(/[-_]/g, " ").toLowerCase();
}

function overviewErrorMessage(cause: unknown): string {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401)
      return "Your admin session is no longer authorized. Please sign in again.";
    if (cause.status === 403) return "Only administrators can view the platform summary.";
    return cause.message;
  }
  return cause instanceof Error ? cause.message : "Unable to load the platform overview.";
}

export default function AdminOverview({ accessToken, onNavigate, onError }: AdminOverviewProps) {
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const load = useCallback(async (token: string): Promise<void> => {
    const id = ++requestId.current;
    setLoadState("loading");
    setError("");
    try {
      const result = await getPlatformSummary(token);
      if (id !== requestId.current) return;
      setSummary(result);
      setLoadState("success");
    } catch (cause) {
      if (id !== requestId.current) return;
      const message = overviewErrorMessage(cause);
      setLoadState("error");
      setError(message);
      onErrorRef.current?.(message);
    }
  }, []);

  useEffect(() => {
    void load(accessToken);
    return () => {
      requestId.current += 1;
    };
  }, [accessToken, load]);

  const recentEvents = summary?.recentAuditEvents ?? [];

  return (
    <section className="admin-overview" aria-labelledby="admin-overview-title">
      <div className="admin-platform-title-row">
        <h3 id="admin-overview-title">Platform Overview</h3>
        <button
          type="button"
          className="platform-refresh-button"
          onClick={() => void load(accessToken)}
        >
          Refresh
        </button>
      </div>

      {loadState === "loading" && <p className="notice">Loading platform overview...</p>}
      {loadState === "error" && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {loadState === "success" && summary && (
        <>
          <div className="metrics" aria-label="Platform metrics">
            <div className="metric primary">
              <span>Users</span>
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
              <span>Available slots</span>
              <strong>{summary.availableSlots}</strong>
            </div>
            <div className="metric">
              <span>Occupied slots</span>
              <strong>{summary.occupiedSlots}</strong>
            </div>
          </div>

          <div className="admin-shortcuts" role="group" aria-label="Admin shortcuts">
            <button type="button" onClick={() => onNavigate("operators")}>
              Verify operators
            </button>
            <button type="button" onClick={() => onNavigate("facilities")}>
              Manage facilities
            </button>
            <button type="button" onClick={() => onNavigate("audit")}>
              Browse audit trail
            </button>
          </div>

          <div className="admin-platform-title-row">
            <h3>Recent activity</h3>
            <span className="reservation-count">{recentEvents.length} latest events</span>
          </div>
          {recentEvents.length === 0 ? (
            <p className="empty-state">No recent platform events.</p>
          ) : (
            <ul className="audit-event-list">
              {recentEvents.map((event) => (
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
                      <dd>
                        {event.actorEmail ??
                          (event.actorUserId === null ? "System" : `User #${event.actorUserId}`)}
                      </dd>
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
          )}
        </>
      )}
    </section>
  );
}
