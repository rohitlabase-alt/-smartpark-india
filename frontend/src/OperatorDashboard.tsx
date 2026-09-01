import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  FACILITY_TYPES,
  type CreateFacilityRequest,
  type FacilityType,
  type Operator,
  type ParkingFacility,
  type ParkingSlot,
  type UpdateFacilityRequest,
} from "@smartpark/shared";
import {
  createOperatorFacility,
  getOperatorFacilities,
  getOperatorFacilitySlots,
  getOperatorMe,
  updateOperatorFacility,
} from "./api/operators";
import { AuthApiError } from "./api/auth";

type LoadState = "loading" | "success" | "error";

function operatorError(cause: unknown): string {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401)
      return "Your operator session is no longer authorized. Please sign in again.";
    if (cause.code === "ACCOUNT_INACTIVE")
      return "Your operator account is inactive and cannot create facilities.";
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
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [facilityType, setFacilityType] = useState<FacilityType | "">("");
  const [facilityCity, setFacilityCity] = useState("");
  const [facilityState, setFacilityState] = useState("");
  const [facilityArea, setFacilityArea] = useState("");
  const [facilityAddress, setFacilityAddress] = useState("");
  const [facilityLatitude, setFacilityLatitude] = useState("");
  const [facilityLongitude, setFacilityLongitude] = useState("");
  const [facilityCapacity, setFacilityCapacity] = useState("");
  const [facilityDescription, setFacilityDescription] = useState("");
  const [editFacilityId, setEditFacilityId] = useState<number>();
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState("");
  const [editSuccess, setEditSuccess] = useState("");
  const [editFacilityName, setEditFacilityName] = useState("");
  const [editFacilityType, setEditFacilityType] = useState<FacilityType | "">("");
  const [editFacilityCity, setEditFacilityCity] = useState("");
  const [editFacilityState, setEditFacilityState] = useState("");
  const [editFacilityArea, setEditFacilityArea] = useState("");
  const [editFacilityAddress, setEditFacilityAddress] = useState("");
  const [editFacilityLatitude, setEditFacilityLatitude] = useState("");
  const [editFacilityLongitude, setEditFacilityLongitude] = useState("");
  const [editFacilityCapacity, setEditFacilityCapacity] = useState("");
  const [editFacilityDescription, setEditFacilityDescription] = useState("");
  const facilityEditRequestId = useRef(0);

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
    setEditFacilityId(undefined);
    setEditSubmitting(false);
    facilityEditRequestId.current += 1;

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

  function handleSelectFacility(facilityId: number): void {
    facilityEditRequestId.current += 1;
    setSelectedFacilityId(facilityId);
    setEditFacilityId(undefined);
    setEditSubmitting(false);
    setEditError("");
    setEditSuccess("");
  }

  function handleOpenEdit(facility: ParkingFacility): void {
    facilityEditRequestId.current += 1;
    setEditFacilityId(facility.id);
    setEditSubmitting(false);
    setEditError("");
    setEditSuccess("");
    setEditFacilityName(facility.name);
    setEditFacilityType(facility.type);
    setEditFacilityCity(facility.city);
    setEditFacilityState(facility.state ?? "");
    setEditFacilityArea(facility.area ?? "");
    setEditFacilityAddress(facility.address ?? "");
    setEditFacilityLatitude(facility.latitude === null ? "" : String(facility.latitude));
    setEditFacilityLongitude(facility.longitude === null ? "" : String(facility.longitude));
    setEditFacilityCapacity(String(facility.capacity));
    setEditFacilityDescription(facility.description ?? "");
  }

  function handleCloseEdit(): void {
    facilityEditRequestId.current += 1;
    setEditFacilityId(undefined);
    setEditSubmitting(false);
    setEditError("");
  }

  async function handleUpdateFacility(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (editSubmitting || editFacilityId === undefined) return;
    setEditError("");
    setEditSuccess("");
    const capacity = Number(editFacilityCapacity);
    if (
      !editFacilityName.trim() ||
      !editFacilityType ||
      !FACILITY_TYPES.includes(editFacilityType as FacilityType) ||
      !editFacilityCity.trim()
    ) {
      setEditError("Name, facility type, and city are required.");
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) {
      setEditError("Capacity must be a whole number between 1 and 100,000.");
      return;
    }
    const latitude = editFacilityLatitude.trim() ? Number(editFacilityLatitude) : undefined;
    const longitude = editFacilityLongitude.trim() ? Number(editFacilityLongitude) : undefined;
    if (
      (latitude !== undefined && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (longitude !== undefined &&
        (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
    ) {
      setEditError("Enter valid latitude and longitude coordinates.");
      return;
    }
    const request: UpdateFacilityRequest = {
      name: editFacilityName.trim(),
      type: editFacilityType,
      city: editFacilityCity.trim(),
      capacity,
    };
    if (editFacilityState.trim()) request.state = editFacilityState.trim();
    if (editFacilityArea.trim()) request.area = editFacilityArea.trim();
    if (editFacilityAddress.trim()) request.address = editFacilityAddress.trim();
    if (editFacilityDescription.trim()) request.description = editFacilityDescription.trim();
    if (latitude !== undefined) request.latitude = latitude;
    if (longitude !== undefined) request.longitude = longitude;

    const facilityId = editFacilityId;
    const requestId = ++facilityEditRequestId.current;
    setEditSubmitting(true);
    try {
      const updated = await updateOperatorFacility(accessToken, facilityId, request);
      if (requestId !== facilityEditRequestId.current) return;
      setFacilities((current) =>
        current.map((facility) => (facility.id === updated.id ? updated : facility)),
      );
      setSelectedFacilityId(updated.id);
      setEditFacilityId(undefined);
      setEditSuccess(`${updated.name} was updated successfully.`);
    } catch (cause) {
      if (requestId !== facilityEditRequestId.current) return;
      setEditError(operatorError(cause));
    } finally {
      if (requestId === facilityEditRequestId.current) setEditSubmitting(false);
    }
  }

  async function handleCreateFacility(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreateError("");
    setCreateSuccess("");
    const capacity = Number(facilityCapacity);
    if (
      !facilityName.trim() ||
      !facilityType ||
      !FACILITY_TYPES.includes(facilityType as FacilityType) ||
      !facilityCity.trim()
    ) {
      setCreateError("Name, facility type, and city are required.");
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) {
      setCreateError("Capacity must be a whole number between 1 and 100,000.");
      return;
    }
    const latitude = facilityLatitude.trim() ? Number(facilityLatitude) : undefined;
    const longitude = facilityLongitude.trim() ? Number(facilityLongitude) : undefined;
    if (
      (latitude !== undefined && !Number.isFinite(latitude)) ||
      (longitude !== undefined && !Number.isFinite(longitude))
    ) {
      setCreateError("Enter valid latitude and longitude coordinates.");
      return;
    }
    const input: CreateFacilityRequest = {
      name: facilityName.trim(),
      type: facilityType,
      city: facilityCity.trim(),
      capacity,
    };
    if (facilityState.trim()) input.state = facilityState.trim();
    if (facilityArea.trim()) input.area = facilityArea.trim();
    if (facilityAddress.trim()) input.address = facilityAddress.trim();
    if (facilityDescription.trim()) input.description = facilityDescription.trim();
    if (latitude !== undefined) input.latitude = latitude;
    if (longitude !== undefined) input.longitude = longitude;

    setCreateSubmitting(true);
    try {
      const created = await createOperatorFacility(accessToken, input);
      setFacilities((current) => [...current, created]);
      setCreateSuccess(
        created.verificationStatus === "PENDING"
          ? `${created.name} was created and is pending verification.`
          : `${created.name} was created with ${label(created.verificationStatus)} verification status.`,
      );
      setFacilityName("");
      setFacilityType("");
      setFacilityCity("");
      setFacilityState("");
      setFacilityArea("");
      setFacilityAddress("");
      setFacilityLatitude("");
      setFacilityLongitude("");
      setFacilityCapacity("");
      setFacilityDescription("");
    } catch (cause) {
      setCreateError(operatorError(cause));
    } finally {
      setCreateSubmitting(false);
    }
  }

  return (
    <section className="operator-dashboard" aria-labelledby="operator-dashboard-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Operations</p>
          <h2 id="operator-dashboard-title">Operator Dashboard</h2>
        </div>
        <span className="reservation-count">Facility management</span>
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
          <button
            type="button"
            onClick={() => {
              setCreateOpen((open) => !open);
              setCreateError("");
            }}
          >
            {createOpen ? "Close facility form" : "Create facility"}
          </button>
          {createOpen && (
            <form
              className="facility-create-form"
              onSubmit={(event) => void handleCreateFacility(event)}
            >
              <label htmlFor="facility-name">Name</label>
              <input
                id="facility-name"
                value={facilityName}
                onChange={(event) => setFacilityName(event.target.value)}
              />
              <label htmlFor="facility-type">Facility type</label>
              <select
                id="facility-type"
                value={facilityType}
                onChange={(event) => setFacilityType(event.target.value as FacilityType)}
              >
                <option value="">Select a type</option>
                {FACILITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {label(type)}
                  </option>
                ))}
              </select>
              <label htmlFor="facility-city">City</label>
              <input
                id="facility-city"
                value={facilityCity}
                onChange={(event) => setFacilityCity(event.target.value)}
              />
              <label htmlFor="facility-state">State</label>
              <input
                id="facility-state"
                value={facilityState}
                onChange={(event) => setFacilityState(event.target.value)}
              />
              <label htmlFor="facility-area">Area</label>
              <input
                id="facility-area"
                value={facilityArea}
                onChange={(event) => setFacilityArea(event.target.value)}
              />
              <label htmlFor="facility-address">Address</label>
              <input
                id="facility-address"
                value={facilityAddress}
                onChange={(event) => setFacilityAddress(event.target.value)}
              />
              <label htmlFor="facility-latitude">Latitude</label>
              <input
                id="facility-latitude"
                type="number"
                step="any"
                min="-90"
                max="90"
                value={facilityLatitude}
                onChange={(event) => setFacilityLatitude(event.target.value)}
              />
              <label htmlFor="facility-longitude">Longitude</label>
              <input
                id="facility-longitude"
                type="number"
                step="any"
                min="-180"
                max="180"
                value={facilityLongitude}
                onChange={(event) => setFacilityLongitude(event.target.value)}
              />
              <label htmlFor="facility-capacity">Capacity</label>
              <input
                id="facility-capacity"
                type="number"
                min="1"
                max="100000"
                value={facilityCapacity}
                onChange={(event) => setFacilityCapacity(event.target.value)}
              />
              <label htmlFor="facility-description">Description</label>
              <textarea
                id="facility-description"
                value={facilityDescription}
                onChange={(event) => setFacilityDescription(event.target.value)}
              />
              {createError && (
                <p className="notice error" role="alert">
                  {createError}
                </p>
              )}
              {createSuccess && (
                <p className="notice success" role="status">
                  {createSuccess}
                </p>
              )}
              <button type="submit" disabled={createSubmitting}>
                {createSubmitting ? "Creating..." : "Submit facility"}
              </button>
            </form>
          )}
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
                  onClick={() => handleSelectFacility(facility.id)}
                  type="button"
                >
                  <strong>{facility.name}</strong>
                  <span>
                    {facility.parkingId} · {facility.city} · Capacity {facility.capacity} ·{" "}
                    {label(facility.verificationStatus)}
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
            {editFacilityId !== selectedFacility.id && (
              <button type="button" onClick={() => handleOpenEdit(selectedFacility)}>
                Edit facility
              </button>
            )}
          </div>
          {editFacilityId === selectedFacility.id && (
            <form
              className="facility-edit-form"
              onSubmit={(event) => void handleUpdateFacility(event)}
            >
              <div className="section-heading compact-heading">
                <h4>Edit facility metadata</h4>
                <button type="button" onClick={handleCloseEdit}>
                  Cancel
                </button>
              </div>
              <label htmlFor="edit-facility-name">Name</label>
              <input
                id="edit-facility-name"
                value={editFacilityName}
                onChange={(event) => setEditFacilityName(event.target.value)}
              />
              <label htmlFor="edit-facility-type">Facility type</label>
              <select
                id="edit-facility-type"
                value={editFacilityType}
                onChange={(event) => setEditFacilityType(event.target.value as FacilityType)}
              >
                <option value="">Select a type</option>
                {FACILITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {label(type)}
                  </option>
                ))}
              </select>
              <label htmlFor="edit-facility-city">City</label>
              <input
                id="edit-facility-city"
                value={editFacilityCity}
                onChange={(event) => setEditFacilityCity(event.target.value)}
              />
              <label htmlFor="edit-facility-state">State</label>
              <input
                id="edit-facility-state"
                value={editFacilityState}
                onChange={(event) => setEditFacilityState(event.target.value)}
              />
              <label htmlFor="edit-facility-area">Area</label>
              <input
                id="edit-facility-area"
                value={editFacilityArea}
                onChange={(event) => setEditFacilityArea(event.target.value)}
              />
              <label htmlFor="edit-facility-address">Address</label>
              <input
                id="edit-facility-address"
                value={editFacilityAddress}
                onChange={(event) => setEditFacilityAddress(event.target.value)}
              />
              <label htmlFor="edit-facility-latitude">Latitude</label>
              <input
                id="edit-facility-latitude"
                type="number"
                step="any"
                value={editFacilityLatitude}
                onChange={(event) => setEditFacilityLatitude(event.target.value)}
              />
              <label htmlFor="edit-facility-longitude">Longitude</label>
              <input
                id="edit-facility-longitude"
                type="number"
                step="any"
                value={editFacilityLongitude}
                onChange={(event) => setEditFacilityLongitude(event.target.value)}
              />
              <label htmlFor="edit-facility-capacity">Capacity</label>
              <input
                id="edit-facility-capacity"
                type="number"
                value={editFacilityCapacity}
                onChange={(event) => setEditFacilityCapacity(event.target.value)}
              />
              <label htmlFor="edit-facility-description">Description</label>
              <textarea
                id="edit-facility-description"
                value={editFacilityDescription}
                onChange={(event) => setEditFacilityDescription(event.target.value)}
              />
              {editError && (
                <p className="notice error" role="alert">
                  {editError}
                </p>
              )}
              <button type="submit" disabled={editSubmitting}>
                {editSubmitting ? "Saving..." : "Save facility"}
              </button>
            </form>
          )}
          {editSuccess && (
            <p className="notice success" role="status">
              {editSuccess}
            </p>
          )}
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
