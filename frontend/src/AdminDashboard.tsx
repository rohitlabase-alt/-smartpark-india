import { useCallback, useEffect, useRef, useState } from "react";
import type { Operator, OperatorStatus } from "@smartpark/shared";
import { approveOperator, listAdminOperators, rejectOperator, reviewOperator } from "./api/admin";
import { AuthApiError } from "./api/auth";

type LoadState = "loading" | "success" | "error";
type Action = "review" | "approve" | "reject";

const STATUS_TABS: { status: OperatorStatus; label: string }[] = [
  { status: "PENDING", label: "Pending" },
  { status: "UNDER_REVIEW", label: "Under Review" },
  { status: "VERIFIED", label: "Verified" },
  { status: "REJECTED", label: "Rejected" },
];

const ACTION_LABELS: Record<Action, string> = {
  review: "Review",
  approve: "Approve",
  reject: "Reject",
};

const ACTION_PROGRESS_LABELS: Record<Action, string> = {
  review: "Reviewing...",
  approve: "Approving...",
  reject: "Rejecting...",
};

const ACTION_PAST_TENSE: Record<Action, string> = {
  review: "reviewed",
  approve: "approved",
  reject: "rejected",
};

interface AdminDashboardProps {
  accessToken: string;
  onError?: (message: string) => void;
}

function label(value: string): string {
  return value.replace(/[-_]/g, " ");
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function adminErrorMessage(cause: unknown, operation: "load" | "action"): string {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401)
      return "Your admin session is no longer authorized. Please sign in again.";
    if (cause.status === 403) return "Only administrators can manage operator verification.";
    if (cause.status === 404) return "This operator could not be found or is no longer available.";
    if (cause.status === 409)
      return "This operator has already changed status. Refresh the list and try again.";
    return cause.message;
  }
  return cause instanceof Error
    ? cause.message
    : operation === "action"
      ? "Unable to update the operator status. Try again."
      : "Unable to load operator verification data.";
}

function availableActions(operator: Operator): { action: Action }[] {
  if (operator.verificationStatus === "PENDING") return [{ action: "review" }];
  if (operator.verificationStatus === "UNDER_REVIEW")
    return [{ action: "approve" }, { action: "reject" }];
  return [];
}

export default function AdminDashboard({ accessToken, onError }: AdminDashboardProps) {
  const [status, setStatus] = useState<OperatorStatus>("PENDING");
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [actionOperatorId, setActionOperatorId] = useState<number>();
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const listRequestId = useRef(0);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const loadOperators = useCallback(
    async (targetStatus: OperatorStatus, token: string): Promise<void> => {
      const requestId = ++listRequestId.current;
      setLoadState("loading");
      setLoadError("");
      setOperators([]);
      try {
        const result = await listAdminOperators(token, targetStatus);
        if (requestId !== listRequestId.current) return;
        setOperators(result);
        setLoadState("success");
      } catch (cause) {
        if (requestId !== listRequestId.current) return;
        const message = adminErrorMessage(cause, "load");
        setLoadState("error");
        setLoadError(message);
        onErrorRef.current?.(message);
      }
    },
    [],
  );

  useEffect(() => {
    setActionError("");
    setActionSuccess("");
    setActionOperatorId(undefined);
    setActionSubmitting(false);
    void loadOperators(status, accessToken);
    return () => {
      listRequestId.current += 1;
    };
  }, [status, accessToken, loadOperators]);

  async function handleAction(operatorId: number, action: Action) {
    if (actionSubmitting || actionOperatorId !== undefined) return;
    const operator = operators.find((entry) => entry.id === operatorId);
    if (!operator) return;
    setActionOperatorId(operatorId);
    setActionSubmitting(true);
    setActionError("");
    setActionSuccess("");
    try {
      if (action === "review") await reviewOperator(accessToken, operatorId);
      else if (action === "approve") await approveOperator(accessToken, operatorId);
      else await rejectOperator(accessToken, operatorId);
      await loadOperators(status, accessToken);
      setActionSuccess(`Operator "${operator.name}" was ${ACTION_PAST_TENSE[action]}.`);
    } catch (cause) {
      const message = adminErrorMessage(cause, "action");
      setActionError(message);
      onErrorRef.current?.(message);
    } finally {
      setActionSubmitting(false);
      setActionOperatorId(undefined);
    }
  }

  return (
    <section className="admin-dashboard" aria-labelledby="admin-dashboard-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Verification</p>
          <h2 id="admin-dashboard-title">Admin Dashboard</h2>
        </div>
        <span className="reservation-count">Operator verification</span>
      </div>

      <fieldset className="admin-status-tabs">
        <legend>Filter by status</legend>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.status}
            type="button"
            aria-pressed={status === tab.status}
            className={status === tab.status ? "admin-status-tab selected" : "admin-status-tab"}
            onClick={() => setStatus(tab.status)}
          >
            {tab.label}
          </button>
        ))}
      </fieldset>

      <div className="admin-status-region" aria-live="polite" aria-busy={loadState === "loading"}>
        {loadState === "loading" && <p className="notice">Loading {label(status)} operators...</p>}
        {loadState === "error" && (
          <p className="notice error" role="alert">
            {loadError}
          </p>
        )}
        {actionSuccess && (
          <p className="notice success" role="status">
            {actionSuccess}
          </p>
        )}
        {actionError && (
          <p className="notice error" role="alert">
            {actionError}
          </p>
        )}
        {loadState === "success" && operators.length === 0 && (
          <p className="empty-state">No operators with {label(status)} status.</p>
        )}
        {loadState === "success" && operators.length > 0 && (
          <ul className="admin-operator-list">
            {operators.map((operator) => (
              <li className="admin-operator-card" key={operator.id}>
                <div className="admin-operator-card-heading">
                  <strong>{operator.name}</strong>
                  <span
                    className={`reservation-status state-${operator.verificationStatus.toLowerCase()}`}
                  >
                    {label(operator.verificationStatus)}
                  </span>
                </div>
                <dl className="admin-operator-details">
                  <div>
                    <dt>Operator ID</dt>
                    <dd>#{operator.id}</dd>
                  </div>
                  <div>
                    <dt>Name</dt>
                    <dd>{operator.name}</dd>
                  </div>
                  <div>
                    <dt>Business type</dt>
                    <dd>{operator.businessType ?? "Not provided"}</dd>
                  </div>
                  <div>
                    <dt>Registration number</dt>
                    <dd>{operator.registrationNumber ?? "Not provided"}</dd>
                  </div>
                  <div>
                    <dt>Verification status</dt>
                    <dd>{label(operator.verificationStatus)}</dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>
                      <time dateTime={operator.createdAt}>
                        {formatTimestamp(operator.createdAt)}
                      </time>
                    </dd>
                  </div>
                </dl>
                {availableActions(operator).length > 0 && (
                  <div className="admin-operator-actions">
                    {availableActions(operator).map(({ action }) => (
                      <button
                        key={action}
                        type="button"
                        className={`admin-${action}-button`}
                        disabled={actionSubmitting}
                        onClick={() => void handleAction(operator.id, action)}
                      >
                        {actionSubmitting && actionOperatorId === operator.id
                          ? ACTION_PROGRESS_LABELS[action]
                          : ACTION_LABELS[action]}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
