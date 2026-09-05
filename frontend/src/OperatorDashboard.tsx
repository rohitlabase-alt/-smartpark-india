import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  FACILITY_TYPES,
  PARKING_SLOT_STATUSES,
  type CreateFacilityRequest,
  type CreateSlotRequest,
  type FacilityType,
  type Operator,
  type ParkingFacility,
  type ParkingSlot,
  type ParkingSlotStatus,
  type Reservation,
  type UpdateFacilityRequest,
  type UpdateSlotRequest,
} from "@smartpark/shared";
import {
  cancelOperatorReservation,
  createOperatorFacility,
  createOperatorSlot,
  getOperatorFacilities,
  getOperatorFacilitySlots,
  getOperatorMe,
  getOperatorReservations,
  updateOperatorFacility,
  updateOperatorSlot,
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

function cancellationErrorMessage(cause: unknown): {
  message: string;
  refreshReservations: boolean;
} {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401) {
      return {
        message: "Your operator session is no longer authorized. Please sign in again.",
        refreshReservations: false,
      };
    }
    if (cause.code === "ACCOUNT_INACTIVE") {
      return { message: "Your operator account is inactive.", refreshReservations: false };
    }
    if (cause.status === 403) {
      return {
        message: "Your account is not authorized to cancel reservations.",
        refreshReservations: false,
      };
    }
    if (cause.status === 404) {
      return {
        message: "This reservation was not found or is no longer in one of your facilities.",
        refreshReservations: false,
      };
    }
    if (cause.status === 409 && cause.code === "ALREADY_CANCELLED") {
      return { message: "This reservation is already cancelled.", refreshReservations: true };
    }
    if (cause.status === 422 && cause.code === "CANNOT_CANCEL_COMPLETED") {
      return {
        message: "Completed reservations cannot be cancelled.",
        refreshReservations: true,
      };
    }
    return { message: cause.message, refreshReservations: false };
  }
  return {
    message: cause instanceof Error ? cause.message : "Unable to cancel the reservation.",
    refreshReservations: false,
  };
}

function label(value: string): string {
  return value.replace(/[-_]/g, " ");
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [reservationsState, setReservationsState] = useState<LoadState>("loading");
  const [reservationsError, setReservationsError] = useState("");
  const [cancellingReservationId, setCancellingReservationId] = useState<number>();
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancellationSubmitting, setCancellationSubmitting] = useState(false);
  const [cancellationError, setCancellationError] = useState("");
  const [cancellationSuccess, setCancellationSuccess] = useState("");
  const cancellationRequestId = useRef(0);
  const reservationsRefreshRequestId = useRef(0);
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
  const [slotCreateOpen, setSlotCreateOpen] = useState(false);
  const [slotCreateSubmitting, setSlotCreateSubmitting] = useState(false);
  const [slotCreateError, setSlotCreateError] = useState("");
  const [slotCreateSuccess, setSlotCreateSuccess] = useState("");
  const [slotCode, setSlotCode] = useState("");
  const [slotVehicleType, setSlotVehicleType] = useState("");
  const [slotStatus, setSlotStatus] = useState<ParkingSlotStatus | "">("");
  const [slotReservationsEnabled, setSlotReservationsEnabled] = useState<"" | "true" | "false">("");
  const slotCreateRequestId = useRef(0);
  const [slotEditId, setSlotEditId] = useState<number>();
  const [slotEditSubmitting, setSlotEditSubmitting] = useState(false);
  const [slotEditError, setSlotEditError] = useState("");
  const [slotEditSuccess, setSlotEditSuccess] = useState("");
  const [slotEditVehicleType, setSlotEditVehicleType] = useState("");
  const [slotEditStatus, setSlotEditStatus] = useState<ParkingSlotStatus | "">("");
  const [slotEditReservationsEnabled, setSlotEditReservationsEnabled] = useState(false);
  const slotEditRequestId = useRef(0);

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
    setReservations([]);
    setReservationsState("loading");
    setReservationsError("");
    setCancellingReservationId(undefined);
    setCancellationReason("");
    setCancellationSubmitting(false);
    setCancellationError("");
    setCancellationSuccess("");
    cancellationRequestId.current += 1;
    reservationsRefreshRequestId.current += 1;
    setEditFacilityId(undefined);
    setEditSubmitting(false);
    facilityEditRequestId.current += 1;
    setSlotCreateOpen(false);
    setSlotCreateSubmitting(false);
    setSlotCreateError("");
    setSlotCreateSuccess("");
    slotCreateRequestId.current += 1;
    setSlotEditId(undefined);
    setSlotEditSubmitting(false);
    setSlotEditError("");
    setSlotEditSuccess("");
    slotEditRequestId.current += 1;

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

    void getOperatorReservations(accessToken).then(
      (result) => {
        if (!active) return;
        setReservations(result.reservations);
        setReservationsState("success");
      },
      (cause: unknown) => {
        if (!active) return;
        setReservationsState("error");
        setReservationsError(operatorError(cause));
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

  function reservationFacilityName(reservation: Reservation): string {
    return (
      facilities.find((facility) => facility.id === reservation.facilityId)?.name ??
      `Facility #${reservation.facilityId}`
    );
  }

  function reservationSlotLabel(reservation: Reservation): string {
    if (reservation.slotId === null) return "Not assigned";
    if (reservation.facilityId !== selectedFacilityId) return `Slot #${reservation.slotId}`;
    return (
      slots.find((slot) => slot.id === reservation.slotId)?.slotCode ??
      `Slot #${reservation.slotId}`
    );
  }

  function handleSelectFacility(facilityId: number): void {
    facilityEditRequestId.current += 1;
    setSelectedFacilityId(facilityId);
    setEditFacilityId(undefined);
    setEditSubmitting(false);
    setEditError("");
    setEditSuccess("");
    setSlotCreateOpen(false);
    setSlotCreateSubmitting(false);
    setSlotCreateError("");
    setSlotCreateSuccess("");
    slotCreateRequestId.current += 1;
    setSlotEditId(undefined);
    setSlotEditSubmitting(false);
    setSlotEditError("");
    setSlotEditSuccess("");
    slotEditRequestId.current += 1;
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

  function handleOpenSlotCreate(): void {
    handleCloseSlotEdit();
    slotCreateRequestId.current += 1;
    setSlotCreateOpen(true);
    setSlotCreateSubmitting(false);
    setSlotCreateError("");
    setSlotCreateSuccess("");
  }

  function handleCloseSlotCreate(): void {
    slotCreateRequestId.current += 1;
    setSlotCreateOpen(false);
    setSlotCreateSubmitting(false);
    setSlotCreateError("");
  }

  function handleOpenSlotEdit(slot: ParkingSlot): void {
    slotCreateRequestId.current += 1;
    slotEditRequestId.current += 1;
    setSlotCreateOpen(false);
    setSlotEditId(slot.id);
    setSlotEditSubmitting(false);
    setSlotEditError("");
    setSlotEditSuccess("");
    setSlotEditVehicleType(slot.vehicleType);
    setSlotEditStatus(slot.status);
    setSlotEditReservationsEnabled(slot.reservationsEnabled);
  }

  function handleCloseSlotEdit(): void {
    slotEditRequestId.current += 1;
    setSlotEditId(undefined);
    setSlotEditSubmitting(false);
    setSlotEditError("");
  }

  function handleRequestCancellation(reservation: Reservation): void {
    cancellationRequestId.current += 1;
    setCancellingReservationId(reservation.id);
    setCancellationReason("");
    setCancellationSubmitting(false);
    setCancellationError("");
    setCancellationSuccess("");
  }

  function handleKeepReservation(): void {
    cancellationRequestId.current += 1;
    setCancellingReservationId(undefined);
    setCancellationSubmitting(false);
    setCancellationError("");
    setCancellationSuccess("");
  }

  function refreshReservations(withinRequestId: number): void {
    const refreshId = ++reservationsRefreshRequestId.current;
    void getOperatorReservations(accessToken).then(
      (result) => {
        if (refreshId !== reservationsRefreshRequestId.current) return;
        if (withinRequestId !== cancellationRequestId.current) return;
        setReservations(result.reservations);
      },
      (cause: unknown) => {
        if (refreshId !== reservationsRefreshRequestId.current) return;
        if (withinRequestId !== cancellationRequestId.current) return;
        setCancellationError(
          cause instanceof Error ? cause.message : "Unable to refresh reservations.",
        );
      },
    );
  }

  async function handleConfirmCancellation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (cancellationSubmitting || cancellingReservationId === undefined) return;
    const reservation = reservations.find((r) => r.id === cancellingReservationId);
    if (!reservation) {
      handleKeepReservation();
      return;
    }
    setCancellationError("");
    setCancellationSuccess("");
    const reason = cancellationReason.trim() || undefined;
    const requestId = ++cancellationRequestId.current;
    setCancellationSubmitting(true);
    try {
      const updated = await cancelOperatorReservation(
        accessToken,
        reservation.reservationCode,
        reason,
      );
      if (requestId !== cancellationRequestId.current) return;
      setReservations((current) => current.map((r) => (r.id === updated.id ? updated : r)));
      setCancellingReservationId(undefined);
      setCancellationReason("");
      setCancellationSuccess(`${reservation.reservationCode} was cancelled.`);
    } catch (cause) {
      if (requestId !== cancellationRequestId.current) return;
      const mapped = cancellationErrorMessage(cause);
      setCancellationError(mapped.message);
      if (mapped.refreshReservations) {
        void refreshReservations(requestId);
      }
    } finally {
      if (requestId === cancellationRequestId.current) setCancellationSubmitting(false);
    }
  }

  async function handleCreateSlot(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (slotCreateSubmitting || selectedFacilityId === undefined) return;
    setSlotCreateError("");
    setSlotCreateSuccess("");
    const trimmedSlotCode = slotCode.trim();
    const trimmedVehicleType = slotVehicleType.trim();
    if (!trimmedSlotCode) {
      setSlotCreateError("Enter a slot code.");
      return;
    }
    if (trimmedSlotCode.length > 40) {
      setSlotCreateError("Slot code must be 40 characters or fewer.");
      return;
    }
    if (trimmedVehicleType.length > 32) {
      setSlotCreateError("Vehicle type must be 32 characters or fewer.");
      return;
    }
    if (slotStatus && !PARKING_SLOT_STATUSES.includes(slotStatus as ParkingSlotStatus)) {
      setSlotCreateError("Select a valid slot status.");
      return;
    }

    const request: CreateSlotRequest = { slotCode: trimmedSlotCode };
    if (trimmedVehicleType) request.vehicleType = trimmedVehicleType;
    if (slotStatus) request.status = slotStatus;
    if (slotReservationsEnabled) request.reservationsEnabled = slotReservationsEnabled === "true";

    const facilityId = selectedFacilityId;
    const requestId = ++slotCreateRequestId.current;
    setSlotCreateSubmitting(true);
    try {
      const created = await createOperatorSlot(accessToken, facilityId, request);
      if (requestId !== slotCreateRequestId.current) return;
      setSlots((current) =>
        current.some((slot) => slot.id === created.id)
          ? current.map((slot) => (slot.id === created.id ? created : slot))
          : [...current, created],
      );
      setSlotCreateOpen(false);
      setSlotCreateSuccess(
        `${created.slotCode} was created with status ${label(created.status)}; reservations are ${created.reservationsEnabled ? "enabled" : "disabled"}.`,
      );
      setSlotCode("");
      setSlotVehicleType("");
      setSlotStatus("");
      setSlotReservationsEnabled("");
    } catch (cause) {
      if (requestId !== slotCreateRequestId.current) return;
      setSlotCreateError(operatorError(cause));
    } finally {
      if (requestId === slotCreateRequestId.current) setSlotCreateSubmitting(false);
    }
  }

  async function handleUpdateSlot(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (slotEditSubmitting || slotEditId === undefined || selectedFacilityId === undefined) return;
    setSlotEditError("");
    setSlotEditSuccess("");
    const vehicleType = slotEditVehicleType.trim();
    if (!vehicleType) {
      setSlotEditError("Enter a vehicle type.");
      return;
    }
    if (vehicleType.length > 32) {
      setSlotEditError("Vehicle type must be 32 characters or fewer.");
      return;
    }
    if (!PARKING_SLOT_STATUSES.includes(slotEditStatus as ParkingSlotStatus)) {
      setSlotEditError("Select a valid slot status.");
      return;
    }
    const facilityId = selectedFacilityId;
    const slotId = slotEditId;
    const request: UpdateSlotRequest = {
      vehicleType,
      status: slotEditStatus as ParkingSlotStatus,
      reservationsEnabled: slotEditReservationsEnabled,
    };
    const requestId = ++slotEditRequestId.current;
    setSlotEditSubmitting(true);
    try {
      const updated = await updateOperatorSlot(accessToken, facilityId, slotId, request);
      if (requestId !== slotEditRequestId.current) return;
      setSlots((current) => current.map((slot) => (slot.id === updated.id ? updated : slot)));
      setSlotEditId(undefined);
      setSlotEditSuccess(
        `${updated.slotCode} was updated with status ${label(updated.status)}; reservations are ${updated.reservationsEnabled ? "enabled" : "disabled"}.`,
      );
    } catch (cause) {
      if (requestId !== slotEditRequestId.current) return;
      setSlotEditError(operatorError(cause));
    } finally {
      if (requestId === slotEditRequestId.current) setSlotEditSubmitting(false);
    }
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

      <section className="operator-panel slots-panel" aria-labelledby="operator-reservations-title">
        <div className="section-heading compact-heading">
          <div>
            <p className="section-kicker">Bookings</p>
            <h3 id="operator-reservations-title">Reservations</h3>
          </div>
          {reservationsState === "success" && (
            <span className="reservation-count">{reservations.length} total</span>
          )}
        </div>
        {reservationsState === "loading" && <p className="notice">Loading reservations...</p>}
        {reservationsState === "error" && (
          <p className="notice error" role="alert">
            {reservationsError}
          </p>
        )}
        {reservationsState === "success" && reservations.length === 0 && (
          <p className="empty-state">No reservations have been made for your facilities.</p>
        )}
        {cancellationSuccess && (
          <p className="notice success" role="status">
            {cancellationSuccess}
          </p>
        )}
        {cancellationError && (
          <p className="notice error" role="alert">
            {cancellationError}
          </p>
        )}
        {reservationsState === "success" && reservations.length > 0 && (
          <ul className="reservation-list">
            {reservations.map((reservation) => (
              <li className="reservation-card" key={reservation.id}>
                <div className="reservation-card-heading">
                  <strong>{reservation.reservationCode}</strong>
                  <span className={`reservation-status state-${reservation.state.toLowerCase()}`}>
                    {label(reservation.state)}
                  </span>
                </div>
                <dl className="reservation-details">
                  <div>
                    <dt>Facility</dt>
                    <dd>{reservationFacilityName(reservation)}</dd>
                  </div>
                  <div>
                    <dt>Slot</dt>
                    <dd>{reservationSlotLabel(reservation)}</dd>
                  </div>
                  {reservation.zoneId !== null && (
                    <div>
                      <dt>Zone</dt>
                      <dd>Zone #{reservation.zoneId}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Start time</dt>
                    <dd>
                      <time dateTime={reservation.startsAt}>
                        {formatTimestamp(reservation.startsAt)}
                      </time>
                    </dd>
                  </div>
                  <div>
                    <dt>End time</dt>
                    <dd>
                      <time dateTime={reservation.endsAt}>
                        {formatTimestamp(reservation.endsAt)}
                      </time>
                    </dd>
                  </div>
                  {reservation.confirmedAt !== null && (
                    <div>
                      <dt>Confirmed</dt>
                      <dd>
                        <time dateTime={reservation.confirmedAt}>
                          {formatTimestamp(reservation.confirmedAt)}
                        </time>
                      </dd>
                    </div>
                  )}
                  {reservation.cancelledAt !== null && (
                    <div>
                      <dt>Cancelled</dt>
                      <dd>
                        <time dateTime={reservation.cancelledAt}>
                          {formatTimestamp(reservation.cancelledAt)}
                        </time>
                      </dd>
                    </div>
                  )}
                  {reservation.cancelReason !== null && (
                    <div>
                      <dt>Cancellation reason</dt>
                      <dd>{reservation.cancelReason}</dd>
                    </div>
                  )}
                </dl>
                {reservation.state === "CONFIRMED" &&
                  cancellingReservationId !== reservation.id && (
                    <button
                      className="cancel-reservation-button"
                      type="button"
                      onClick={() => handleRequestCancellation(reservation)}
                    >
                      Cancel Reservation
                    </button>
                  )}
                {reservation.state === "CONFIRMED" &&
                  cancellingReservationId === reservation.id && (
                    <form
                      className="cancellation-confirmation"
                      role="group"
                      aria-labelledby={`cancel-title-${reservation.id}`}
                      aria-busy={cancellationSubmitting}
                      onSubmit={(event) => void handleConfirmCancellation(event)}
                    >
                      <h4 id={`cancel-title-${reservation.id}`}>Cancel reservation?</h4>
                      <p>
                        {reservation.reservationCode} · {reservationFacilityName(reservation)} ·{" "}
                        {reservationSlotLabel(reservation)}
                      </p>
                      <p>
                        <time dateTime={reservation.startsAt}>
                          {formatTimestamp(reservation.startsAt)}
                        </time>{" "}
                        to{" "}
                        <time dateTime={reservation.endsAt}>
                          {formatTimestamp(reservation.endsAt)}
                        </time>
                      </p>
                      <label htmlFor={`cancellation-reason-${reservation.id}`}>
                        Cancellation reason <span className="optional">(optional)</span>
                      </label>
                      <textarea
                        id={`cancellation-reason-${reservation.id}`}
                        maxLength={500}
                        value={cancellationReason}
                        onChange={(event) => setCancellationReason(event.target.value)}
                      />
                      {cancellationSubmitting && (
                        <p className="cancellation-progress" aria-live="polite">
                          Cancelling reservation...
                        </p>
                      )}
                      <div className="cancellation-actions">
                        <button type="submit" disabled={cancellationSubmitting}>
                          {cancellationSubmitting ? "Cancelling..." : "Confirm Cancellation"}
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={cancellationSubmitting}
                          onClick={handleKeepReservation}
                        >
                          Keep Reservation
                        </button>
                      </div>
                    </form>
                  )}
              </li>
            ))}
          </ul>
        )}
      </section>

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
          <button type="button" onClick={handleOpenSlotCreate}>
            Create Parking Slot
          </button>
          {slotCreateOpen && (
            <form className="slot-create-form" onSubmit={(event) => void handleCreateSlot(event)}>
              <div className="section-heading compact-heading">
                <h4>Create parking slot</h4>
                <button type="button" onClick={handleCloseSlotCreate}>
                  Cancel
                </button>
              </div>
              <label htmlFor="slot-code">Slot code</label>
              <input
                id="slot-code"
                maxLength={40}
                value={slotCode}
                onChange={(event) => setSlotCode(event.target.value)}
              />
              <label htmlFor="slot-vehicle-type">
                Vehicle type <span className="optional">(optional)</span>
              </label>
              <input
                id="slot-vehicle-type"
                maxLength={32}
                value={slotVehicleType}
                onChange={(event) => setSlotVehicleType(event.target.value)}
              />
              <label htmlFor="slot-status">
                Status <span className="optional">(server default: AVAILABLE)</span>
              </label>
              <select
                id="slot-status"
                value={slotStatus}
                onChange={(event) => setSlotStatus(event.target.value as ParkingSlotStatus)}
              >
                <option value="">Use server default</option>
                {PARKING_SLOT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {label(status)}
                  </option>
                ))}
              </select>
              <label htmlFor="slot-reservations-enabled">
                Reservations <span className="optional">(server default: enabled)</span>
              </label>
              <select
                id="slot-reservations-enabled"
                value={slotReservationsEnabled}
                onChange={(event) =>
                  setSlotReservationsEnabled(event.target.value as "" | "true" | "false")
                }
              >
                <option value="">Use server default</option>
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
              {slotCreateError && (
                <p className="notice error" role="alert">
                  {slotCreateError}
                </p>
              )}
              <button type="submit" disabled={slotCreateSubmitting}>
                {slotCreateSubmitting ? "Creating..." : "Create slot"}
              </button>
            </form>
          )}
          {slotCreateSuccess && (
            <p className="notice success" role="status">
              {slotCreateSuccess}
            </p>
          )}
          {slotEditSuccess && (
            <p className="notice success" role="status">
              {slotEditSuccess}
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
                  <div className="operator-slot-summary">
                    <strong>{slot.slotCode}</strong>
                    <button type="button" onClick={() => handleOpenSlotEdit(slot)}>
                      Edit slot
                    </button>
                  </div>
                  <span>
                    {slot.vehicleType} · {label(slot.status)} · reservations{" "}
                    {slot.reservationsEnabled ? "enabled" : "disabled"}
                  </span>
                  {slotEditId === slot.id && (
                    <form
                      className="slot-edit-form"
                      onSubmit={(event) => void handleUpdateSlot(event)}
                    >
                      <div className="section-heading compact-heading">
                        <h4>Edit parking slot</h4>
                        <button type="button" onClick={handleCloseSlotEdit}>
                          Cancel
                        </button>
                      </div>
                      <label htmlFor={`edit-slot-code-${slot.id}`}>Slot code</label>
                      <input id={`edit-slot-code-${slot.id}`} value={slot.slotCode} readOnly />
                      <label htmlFor={`edit-slot-vehicle-type-${slot.id}`}>Vehicle type</label>
                      <input
                        id={`edit-slot-vehicle-type-${slot.id}`}
                        maxLength={32}
                        value={slotEditVehicleType}
                        onChange={(event) => setSlotEditVehicleType(event.target.value)}
                      />
                      <label htmlFor={`edit-slot-status-${slot.id}`}>Status</label>
                      <select
                        id={`edit-slot-status-${slot.id}`}
                        value={slotEditStatus}
                        onChange={(event) =>
                          setSlotEditStatus(event.target.value as ParkingSlotStatus)
                        }
                      >
                        {PARKING_SLOT_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {label(status)}
                          </option>
                        ))}
                      </select>
                      <label htmlFor={`edit-slot-reservations-${slot.id}`}>
                        Reservations enabled
                      </label>
                      <input
                        id={`edit-slot-reservations-${slot.id}`}
                        type="checkbox"
                        checked={slotEditReservationsEnabled}
                        onChange={(event) => setSlotEditReservationsEnabled(event.target.checked)}
                      />
                      {slotEditError && (
                        <p className="notice error" role="alert">
                          {slotEditError}
                        </p>
                      )}
                      <button type="submit" disabled={slotEditSubmitting}>
                        {slotEditSubmitting ? "Saving..." : "Save slot"}
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
