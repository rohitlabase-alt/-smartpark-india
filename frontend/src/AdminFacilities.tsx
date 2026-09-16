import { useCallback, useEffect, useRef, useState } from "react";
import { type OperatorStatus, type ParkingFacility } from "@smartpark/shared";
import {
  activateFacility,
  approveFacility,
  deactivateFacility,
  listAdminFacilities,
  rejectFacility,
  reviewFacility,
} from "./api/admin";
import { AuthApiError } from "./api/auth";

type LoadState = "loading" | "success" | "error";
type FacilityFilter = OperatorStatus | "ALL";
type FacilityAction = "review" | "approve" | "reject" | "activate" | "deactivate";

const STATUS_FILTERS: OperatorStatus[] = ["PENDING", "UNDER_REVIEW", "VERIFIED", "REJECTED"];

const FILTER_TABS: { value: FacilityFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "UNDER_REVIEW", label: "Under Review" },
  { value: "VERIFIED", label: "Verified" },
  { value: "REJECTED", label: "Rejected" },
];

const VERIFICATION_LABELS: Partial<Record<OperatorStatus, string>> = {
  PENDING: "Pending review",
  UNDER_REVIEW: "Under review",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};

function verificationLabel(status: OperatorStatus): string {
  return VERIFICATION_LABELS[status] ?? label(status);
}

const ACTION_LABELS: Record<FacilityAction, string> = {
  review: "Review",
  approve: "Approve",
  reject: "Reject",
  activate: "Activate",
  deactivate: "Deactivate",
};

const ACTION_PROGRESS_LABELS: Record<FacilityAction, string> = {
  review: "Reviewing...",
  approve: "Approving...",
  reject: "Rejecting...",
  activate: "Activating...",
  deactivate: "Deactivating...",
};

const ACTION_PAST_TENSE: Record<FacilityAction, string> = {
  review: "reviewed",
  approve: "approved",
  reject: "rejected",
  activate: "activated",
  deactivate: "deactivated",
};

interface AdminFacilitiesProps {
  accessToken: string;
  onError?: (message: string) => void;
}

function label(value: string): string {
  return value.replace(/[-_]/g, " ");
}

function availableFacilityActions(facility: ParkingFacility): FacilityAction[] {
  if (facility.verificationStatus === "PENDING") return ["review"];
  if (facility.verificationStatus === "UNDER_REVIEW") return ["approve", "reject"];
  if (facility.verificationStatus === "VERIFIED")
    return facility.isActive ? ["deactivate"] : ["activate"];
  return [];
}

function facilityAdminErrorMessage(cause: unknown, operation: "load" | "action"): string {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401)
      return "Your admin session is no longer authorized. Please sign in again.";
    if (cause.status === 403) return "Only administrators can manage facilities.";
    if (cause.status === 404) return "This facility could not be found or is no longer available.";
    if (cause.status === 409)
      return "This facility has already changed status. Refresh the list and try again.";
    return cause.message;
  }
  return cause instanceof Error
    ? cause.message
    : operation === "action"
      ? "Unable to update the facility. Try again."
      : "Unable to load facility management data.";
}

export default function AdminFacilities({ accessToken, onError }: AdminFacilitiesProps) {
  const [filter, setFilter] = useState<FacilityFilter>("PENDING");
  const [facilities, setFacilities] = useState<ParkingFacility[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [actionFacilityId, setActionFacilityId] = useState<number>();
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const listRequestId = useRef(0);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const loadFacilities = useCallback(
    async (targetFilter: FacilityFilter, token: string): Promise<void> => {
      const requestId = ++listRequestId.current;
      setLoadState("loading");
      setLoadError("");
      setFacilities([]);
      try {
        const result =
          targetFilter === "ALL"
            ? await Promise.all(STATUS_FILTERS.map((status) => listAdminFacilities(token, status)))
            : [await listAdminFacilities(token, targetFilter)];
        if (requestId !== listRequestId.current) return;
        const merged = new Map<number, ParkingFacility>();
        for (const list of result) {
          for (const facility of list) merged.set(facility.id, facility);
        }
        const sorted = Array.from(merged.values()).sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        );
        setFacilities(sorted);
        setLoadState("success");
      } catch (cause) {
        if (requestId !== listRequestId.current) return;
        const message = facilityAdminErrorMessage(cause, "load");
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
    setActionFacilityId(undefined);
    setActionSubmitting(false);
    void loadFacilities(filter, accessToken);
    return () => {
      listRequestId.current += 1;
    };
  }, [filter, accessToken, loadFacilities]);

  async function handleAction(facilityId: number, action: FacilityAction) {
    if (actionSubmitting || actionFacilityId !== undefined) return;
    const facility = facilities.find((entry) => entry.id === facilityId);
    if (!facility) return;
    setActionFacilityId(facilityId);
    setActionSubmitting(true);
    setActionError("");
    setActionSuccess("");
    try {
      if (action === "review") await reviewFacility(accessToken, facilityId);
      else if (action === "approve") await approveFacility(accessToken, facilityId);
      else if (action === "reject") await rejectFacility(accessToken, facilityId);
      else if (action === "activate") await activateFacility(accessToken, facilityId);
      else await deactivateFacility(accessToken, facilityId);
      await loadFacilities(filter, accessToken);
      setActionSuccess(`Facility "${facility.name}" was ${ACTION_PAST_TENSE[action]}.`);
    } catch (cause) {
      const message = facilityAdminErrorMessage(cause, "action");
      setActionError(message);
      onErrorRef.current?.(message);
    } finally {
      setActionSubmitting(false);
      setActionFacilityId(undefined);
    }
  }

  const loadingLabel = filter === "ALL" ? "all" : label(filter);

  return (
    <div className="admin-facilities" aria-labelledby="admin-facilities-title">
      <fieldset className="admin-status-tabs">
        <legend>Filter by status</legend>
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={filter === tab.value}
            className={filter === tab.value ? "admin-status-tab selected" : "admin-status-tab"}
            onClick={() => setFilter(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </fieldset>

      <div className="admin-status-region" aria-live="polite" aria-busy={loadState === "loading"}>
        {loadState === "loading" && <p className="notice">Loading {loadingLabel} facilities...</p>}
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
        {loadState === "success" && facilities.length === 0 && (
          <p className="empty-state">
            {filter === "ALL"
              ? "No facilities to display."
              : `No facilities with ${label(filter)} status.`}
          </p>
        )}
        {loadState === "success" && facilities.length > 0 && (
          <ul className="admin-facility-list">
            {facilities.map((facility) => (
              <li className="admin-facility-card" key={facility.id}>
                <div className="admin-facility-card-heading">
                  <strong>{facility.name}</strong>
                  <span className="admin-facility-badges">
                    <span
                      className={`reservation-status state-${facility.verificationStatus.toLowerCase()}`}
                    >
                      {verificationLabel(facility.verificationStatus)}
                    </span>
                    <span
                      className={`reservation-status ${
                        facility.isActive ? "state-active" : "state-inactive"
                      }`}
                    >
                      {facility.isActive ? "Active" : "Inactive"}
                    </span>
                  </span>
                </div>
                <dl className="admin-facility-details">
                  <div>
                    <dt>Parking ID</dt>
                    <dd>{facility.parkingId}</dd>
                  </div>
                  <div>
                    <dt>Facility</dt>
                    <dd>{facility.name}</dd>
                  </div>
                  <div>
                    <dt>City</dt>
                    <dd>{facility.city}</dd>
                  </div>
                  <div>
                    <dt>Area</dt>
                    <dd>{facility.area ?? "Not provided"}</dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd>{facility.address ?? "Not provided"}</dd>
                  </div>
                  <div>
                    <dt>Operator</dt>
                    <dd>#{facility.operatorId}</dd>
                  </div>
                  <div>
                    <dt>Capacity</dt>
                    <dd>{facility.capacity}</dd>
                  </div>
                  <div>
                    <dt>Verification status</dt>
                    <dd>{verificationLabel(facility.verificationStatus)}</dd>
                  </div>
                  <div>
                    <dt>Availability</dt>
                    <dd>{facility.isActive ? "Active" : "Inactive"}</dd>
                  </div>
                </dl>
                {availableFacilityActions(facility).length > 0 && (
                  <div className="admin-facility-actions">
                    {availableFacilityActions(facility).map((action) => (
                      <button
                        key={action}
                        type="button"
                        className={`admin-facility-${action}-button`}
                        disabled={actionSubmitting}
                        onClick={() => void handleAction(facility.id, action)}
                      >
                        {actionSubmitting && actionFacilityId === facility.id
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
    </div>
  );
}
