import { useEffect, useRef, useState } from "react";
import type { PlatformSummary } from "@smartpark/shared";
import { getPlatformSummary } from "./api/admin";
import { AuthApiError } from "./api/auth";

type LoadState = "loading" | "success" | "error";

interface AdminPlatformProps {
  accessToken: string;
  onError?: (message: string) => void;
}

function label(value: string): string {
  return value.replace(/[-_]/g, " ").toLowerCase();
}

function platformErrorMessage(cause: unknown): string {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401)
      return "Your admin session is no longer authorized. Please sign in again.";
    if (cause.status === 403) return "Only administrators can view platform analytics.";
    return cause.message;
  }
  return cause instanceof Error ? cause.message : "Unable to load platform analytics.";
}

export default function AdminPlatform({ accessToken, onError }: AdminPlatformProps) {
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");

  const requestId = useRef(0);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const load = async (token: string): Promise<void> => {
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
      const message = platformErrorMessage(cause);
      setLoadState("error");
      setError(message);
      onErrorRef.current?.(message);
    }
  };

  useEffect(() => {
    void load(accessToken);
    return () => {
      requestId.current += 1;
    };
  }, [accessToken]);

  return (
    <div className="admin-platform" aria-labelledby="admin-platform-title">
      <div className="platform-summary">
        <div className="platform-summary-heading">
          <div className="admin-platform-title-row">
            <h3 id="admin-platform-title">Platform Overview</h3>
            <button
              type="button"
              className="platform-refresh-button"
              onClick={() => void load(accessToken)}
            >
              Refresh
            </button>
          </div>
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
