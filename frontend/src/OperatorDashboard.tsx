import { useEffect, useState } from "react";
import type { Operator, ParkingFacility, ParkingSlot } from "@smartpark/shared";
import { getOperatorFacilities, getOperatorFacilitySlots, getOperatorMe } from "./api/operators";
import { AuthApiError } from "./api/auth";

type LoadState = "loading" | "success" | "error";

function operatorError(cause: unknown): string {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401)
      return "Your operator session is no longer authorized. Please sign in again.";
    if (cause.status === 403) return "Your account is not authorized to access operator data.";
    return cause.message;
  }
  return cause instanceof Error ? cause.message : "Unable to load operator data.";
}

function label(value: string): string {
  return value.replace(/[-_]/g, " ");
}

export default function OperatorDashboard({ accessToken }: { accessToken: string }) {
  const [operator, setOperator] = useState<Operator>();
  const [operatorState, setOperatorState] = useState<LoadState>("loading");
  const [operatorErrorMessage, setOperatorErrorMessage] = useState("");
  const [facilities, setFacilities] = useState<ParkingFacility[]>([]);
  const [facilitiesState, setFacilitiesState] = useState<LoadState>("loading");
  const [facilitiesError, setFacilitiesError] = useState("");
  const [selectedFacilityId, setSelectedFacilityId] = useState<number>();
  const [slots, setSlots] = useState<ParkingSlot[]>([]);
  const [slotsState, setSlotsState] = useState<LoadState>("success");
  const [slotsError, setSlotsError] = useState("");

  useEffect(() => {
    let active = true;
    setOperatorState("loading");
    setFacilitiesState("loading");
    setOperatorErrorMessage("");
    setFacilitiesError("");
    setOperator(undefined);
    setFacilities([]);
    setSelectedFacilityId(undefined);
    setSlots([]);
    setSlotsState("success");
    setSlotsError("");

    void getOperatorMe(accessToken).then(
      (result) => {
        if (!active) return;
        setOperator(result);
        setOperatorState("success");
      },
      (cause: unknown) => {
        if (!active) return;
        setOperatorState("error");
        setOperatorErrorMessage(operatorError(cause));
      },
    );

    void getOperatorFacilities(accessToken).then(
      (result) => {
        if (!active) return;
        setFacilities(result);
        setFacilitiesState("success");
        setSelectedFacilityId(result[0]?.id);
      },
      (cause: unknown) => {
        if (!active) return;
        setFacilitiesState("error");
        setFacilitiesError(operatorError(cause));
      },
    );

    return () => {
      active = false;
    };
  }, [accessToken]);

  useEffect(() => {
    if (selectedFacilityId === undefined) {
      setSlots([]);
      setSlotsState("success");
      setSlotsError("");
      return;
    }

    let active = true;
    setSlotsState("loading");
    setSlotsError("");
    setSlots([]);
    void getOperatorFacilitySlots(accessToken, selectedFacilityId).then(
      (result) => {
        if (!active) return;
        setSlots(result);
        setSlotsState("success");
      },
      (cause: unknown) => {
        if (!active) return;
        setSlotsState("error");
        setSlotsError(operatorError(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [accessToken, selectedFacilityId]);

  const selectedFacility = facilities.find((facility) => facility.id === selectedFacilityId);

  return (
    <section className="operator-dashboard" aria-labelledby="operator-dashboard-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Operations</p>
          <h2 id="operator-dashboard-title">Operator Dashboard</h2>
        </div>
        <span className="reservation-count">Read-only view</span>
      </div>

      <div className="operator-grid">
        <section className="operator-panel" aria-labelledby="operator-profile-title">
          <p className="section-kicker">Organization</p>
          <h3 id="operator-profile-title">Operator profile</h3>
          {operatorState === "loading" && <p className="notice">Loading operator profile...</p>}
          {operatorState === "error" && (
            <p className="notice error" role="alert">
              {operatorErrorMessage}
            </p>
          )}
          {operatorState === "success" && operator && (
            <dl className="operator-details">
              <div>
                <dt>Name</dt>
                <dd>{operator.name}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{label(operator.verificationStatus)}</dd>
              </div>
              {operator.businessType && (
                <div>
                  <dt>Business type</dt>
                  <dd>{operator.businessType}</dd>
                </div>
              )}
              {operator.registrationNumber && (
                <div>
                  <dt>Registration number</dt>
                  <dd>{operator.registrationNumber}</dd>
                </div>
              )}
            </dl>
          )}
        </section>

        <section className="operator-panel" aria-labelledby="operator-facilities-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="section-kicker">Portfolio</p>
              <h3 id="operator-facilities-title">Your facilities</h3>
            </div>
            {facilitiesState === "success" && (
              <span className="reservation-count">{facilities.length} total</span>
            )}
          </div>
          {facilitiesState === "loading" && <p className="notice">Loading facilities...</p>}
          {facilitiesState === "error" && (
            <p className="notice error" role="alert">
              {facilitiesError}
            </p>
          )}
          {facilitiesState === "success" && facilities.length === 0 && (
            <p className="empty-state">No facilities are associated with this operator.</p>
          )}
          {facilities.length > 0 && (
            <div className="facility-list" role="list" aria-label="Operator facilities">
              {facilities.map((facility) => (
                <button
                  className={
                    facility.id === selectedFacilityId ? "facility-item selected" : "facility-item"
                  }
                  key={facility.id}
                  onClick={() => setSelectedFacilityId(facility.id)}
                  type="button"
                >
                  <strong>{facility.name}</strong>
                  <span>
                    {facility.city} · {label(facility.verificationStatus)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {selectedFacility && (
        <section className="operator-panel slots-panel" aria-labelledby="operator-slots-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="section-kicker">Facility detail</p>
              <h3 id="operator-slots-title">{selectedFacility.name} slots</h3>
            </div>
            <span className="reservation-count">Capacity {selectedFacility.capacity}</span>
          </div>
          {slotsState === "loading" && <p className="notice">Loading slots...</p>}
          {slotsState === "error" && (
            <p className="notice error" role="alert">
              {slotsError}
            </p>
          )}
          {slotsState === "success" && slots.length === 0 && (
            <p className="empty-state">This facility has no slots to display.</p>
          )}
          {slotsState === "success" && slots.length > 0 && (
            <ul className="operator-slot-list">
              {slots.map((slot) => (
                <li key={slot.id}>
                  <strong>{slot.slotCode}</strong>
                  <span>
                    {slot.vehicleType} · {label(slot.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
