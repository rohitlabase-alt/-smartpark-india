import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  MODE_STATUS,
  MVP_STATUS,
  type BookingStatus,
  type BookingListResponse,
  type BookingResponse,
  type FacilityAvailabilityResponse,
  type LoginRequest,
  type Operator,
  type ParkingSession,
  type ParkingSlot,
  type Reservation,
  type RegisterRequest,
} from "@smartpark/shared";
import AdminDashboard from "./AdminDashboard";
import PlaceholderBanner from "./components/PlaceholderBanner";
import OperatorDashboard from "./OperatorDashboard";
import OperatorRegistration from "./OperatorRegistration";
import { fetchFacilityAvailability, AvailabilityApiError } from "./api/availability";
import {
  cancelReservation,
  createReservation,
  fetchReservations,
  getReservation,
} from "./api/reservations";
import { initiatePayment, verifyPayment } from "./api/payments";
import { enterParking, exitParking, getParkingSessionByReservation } from "./api/sessions";
import {
  AuthApiError,
  clearMemorySession,
  getCurrentUser,
  getMemorySession,
  login,
  logout,
  refresh,
  register,
  setMemorySession,
  type AuthSession,
} from "./api/auth";

type ViewState = "initial" | "loading" | "success" | "error";
type Screen =
  | "admin"
  | "availability"
  | "login"
  | "register"
  | "reservations"
  | "operator"
  | "operator-registration";
type SessionState = "loading" | "authenticated" | "unauthenticated";
type ReservationsState = "initial" | "loading" | "success" | "error";
type ReservationDetailState = "initial" | "loading" | "success" | "error";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function bookingStatusLabel(status: BookingStatus): string {
  return statusLabel(status);
}

function bookableSlots(availability: FacilityAvailabilityResponse): ParkingSlot[] {
  return availability.slots.filter(
    (slot) =>
      slot.reservationsEnabled && (slot.status === "AVAILABLE" || slot.status === "RESERVED"),
  );
}

function reservationCreationError(cause: unknown): string {
  if (cause instanceof AuthApiError) {
    switch (cause.code) {
      case "VALIDATION_ERROR":
        return "Check the slot and date/time values, then try again.";
      case "FACILITY_NOT_FOUND":
        return "This parking facility is currently unavailable.";
      case "SLOT_NOT_FOUND":
        return "This parking slot is no longer available.";
      case "SLOT_UNAVAILABLE":
        return "This slot cannot be reserved right now.";
      case "RESERVATION_CONFLICT":
        return "This slot is no longer available for that time. Choose another time or slot.";
      case "UNAUTHORIZED":
        return "You are not authorized to create reservations.";
    }
  }
  return cause instanceof Error ? cause.message : "Unable to create your reservation.";
}

function cancellationErrorMessage(cause: unknown): string {
  if (cause instanceof AuthApiError) {
    switch (cause.code) {
      case "UNAUTHORIZED":
        return "You are not authorized to cancel this reservation.";
      case "BOOKING_NOT_FOUND":
        return "This reservation could not be found.";
      case "ALREADY_CANCELLED":
        return "This reservation is already cancelled.";
      case "CANNOT_CANCEL_COMPLETED":
        return "This reservation has already been completed and cannot be cancelled.";
    }
  }
  return cause instanceof Error ? cause.message : "Unable to cancel your reservation.";
}

function reservationDetailErrorMessage(cause: unknown): string {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401) return "You are not authorized to view this reservation.";
    if (cause.code === "BOOKING_NOT_FOUND")
      return "This reservation could not be found or is no longer available.";
  }
  return cause instanceof Error ? cause.message : "Unable to load reservation details.";
}

function availabilityErrorMessage(cause: unknown): string {
  if (cause instanceof AvailabilityApiError && cause.status === 404) {
    return "This parking facility is currently unavailable.";
  }
  return cause instanceof Error ? cause.message : "Unable to load availability.";
}

function formatCurrency(amount: number | null): string {
  return typeof amount === "number" && Number.isFinite(amount) ? `₹${amount.toFixed(2)}` : "";
}

function paymentErrorMessage(cause: unknown): string {
  if (cause instanceof AuthApiError) {
    switch (cause.code) {
      case "UNAUTHORIZED":
        return "You are not authorized to make this payment.";
      case "BOOKING_NOT_FOUND":
        return "This reservation could not be found.";
      case "PAYMENT_NOT_PENDING":
        return "This reservation is no longer waiting for payment.";
      case "PAYMENT_UNAVAILABLE":
        return "This reservation has no amount to charge.";
      case "PAYMENT_NOT_FOUND":
        return "This payment could not be found.";
      case "PAYMENT_ALREADY_FAILED":
        return "This payment already failed. Please refresh and try again.";
      case "RESERVATION_NOT_CONFIRMABLE":
        return "This reservation can no longer be confirmed.";
    }
  }
  return cause instanceof Error ? cause.message : "Unable to process this payment.";
}

function generateIdempotencyKey(): string {
  const cryptoImpl = globalThis.crypto;
  if (cryptoImpl && typeof cryptoImpl.randomUUID === "function") {
    return cryptoImpl.randomUUID();
  }
  if (cryptoImpl && typeof cryptoImpl.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoImpl.getRandomValues(bytes);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }
  return `idempotency-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parkingSessionErrorMessage(cause: unknown): string {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401) return "Your session is no longer authorized. Please sign in again.";
    if (cause.status === 403) return "You are not authorized to perform this parking action.";
    switch (cause.code) {
      case "BOOKING_NOT_FOUND":
        return "No reservation matches this booking reference.";
      case "SESSION_NOT_FOUND":
        return "No parking session was found for this reservation.";
      case "SESSION_ALREADY_ACTIVE":
        return "This reservation already has an active parking session.";
      case "RESERVATION_NOT_ENTRYABLE":
        return "This reservation is not ready for entry yet.";
      case "FACILITY_NOT_ENTRYABLE":
        return "This facility is not accepting entries right now.";
      case "SLOT_NOT_ASSIGNED":
        return "This reservation has not been assigned a parking slot yet.";
      case "SLOT_OCCUPIED":
        return "The assigned slot is currently occupied.";
      case "SESSION_NOT_ACTIVE":
        return "This session is no longer active.";
    }
  }
  return cause instanceof Error ? cause.message : "Unable to complete the parking operation.";
}

type ParkingPanelState = "idle" | "entering" | "active" | "exiting" | "complete" | "error";

function ParkingSessionPanel({
  accessToken,
  reservation,
}: {
  accessToken: string;
  reservation: Reservation;
}) {
  const [state, setState] = useState<ParkingPanelState>("idle");
  const [session, setSession] = useState<ParkingSession>();
  const [entryToken, setEntryToken] = useState<string>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copiedEntryToken, setCopiedEntryToken] = useState(false);
  const requestId = useRef(0);

  async function handleEnter(): Promise<void> {
    if (state === "entering") return;
    const currentRequestId = ++requestId.current;
    setState("entering");
    setError("");
    setMessage("");
    try {
      const result = await enterParking(accessToken, reservation.reservationCode);
      if (currentRequestId !== requestId.current) return;
      setSession(result.session);
      setEntryToken(result.entryToken);
      setMessage("Vehicle entered. Copy the one-time token for the entry gate.");
      setState("active");
    } catch (cause) {
      if (currentRequestId !== requestId.current) return;
      if (cause instanceof AuthApiError && cause.code === "SESSION_ALREADY_ACTIVE") {
        try {
          const current = await getParkingSessionByReservation(
            accessToken,
            reservation.reservationCode,
          );
          if (currentRequestId !== requestId.current) return;
          setSession(current.session);
          setEntryToken(undefined);
          setMessage("This reservation already has an active parking session.");
          setState("active");
        } catch (innerCause) {
          if (currentRequestId !== requestId.current) return;
          setError(parkingSessionErrorMessage(innerCause));
          setState("error");
        }
        return;
      }
      setError(parkingSessionErrorMessage(cause));
      setState("error");
    }
  }

  async function handleExit(): Promise<void> {
    if (!session || state === "exiting") return;
    const currentRequestId = ++requestId.current;
    setState("exiting");
    setError("");
    try {
      const completed = await exitParking(accessToken, session.id);
      if (currentRequestId !== requestId.current) return;
      setSession(completed.session);
      setEntryToken(undefined);
      setMessage("Vehicle exited; the slot was released.");
      setState("complete");
    } catch (cause) {
      if (currentRequestId !== requestId.current) return;
      setError(parkingSessionErrorMessage(cause));
      setState("active");
    }
  }

  async function copyEntryToken(): Promise<void> {
    if (!entryToken) return;
    setCopiedEntryToken(false);
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(entryToken);
      setCopiedEntryToken(true);
    } catch {
      setCopiedEntryToken(false);
    }
  }

  if (reservation.state !== "CONFIRMED") return null;

  const hasSession = session !== undefined;

  return (
    <section
      className="parking-session-panel"
      aria-labelledby={`parking-session-title-${reservation.reservationCode}`}
    >
      <div className="section-heading">
        <div>
          <p className="section-kicker">Parking</p>
          <h4 id={`parking-session-title-${reservation.reservationCode}`}>Parking session</h4>
        </div>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {state === "entering" && (
        <p className="notice" aria-live="polite">
          Starting your parking session...
        </p>
      )}
      {hasSession && (
        <dl className="reservation-detail-list">
          <div>
            <dt>Status</dt>
            <dd>{statusLabel(session!.status)}</dd>
          </div>
          <div>
            <dt>Slot ID</dt>
            <dd>{session!.slotId}</dd>
          </div>
          <div>
            <dt>Entered</dt>
            <dd>
              <time dateTime={session!.entryAt}>{formatTimestamp(session!.entryAt)}</time>
            </dd>
          </div>
          {session!.exitAt && (
            <div>
              <dt>Exited</dt>
              <dd>
                <time dateTime={session!.exitAt}>{formatTimestamp(session!.exitAt)}</time>
              </dd>
            </div>
          )}
        </dl>
      )}
      {entryToken && (
        <div className="parking-entry-result">
          <p className="entry-token-label">
            Entry token <span className="optional">(one-time)</span>
          </p>
          <code className="entry-token-code" aria-label="Entry token">
            {entryToken}
          </code>
          <button type="button" onClick={() => void copyEntryToken()}>
            {copiedEntryToken ? "Copied" : "Copy entry token"}
          </button>
        </div>
      )}
      {(state === "idle" || state === "error" || state === "complete") && (
        <button type="button" onClick={() => void handleEnter()}>
          Enter parking
        </button>
      )}
      {state === "active" && (
        <button className="secondary-button" type="button" onClick={() => void handleExit()}>
          Exit vehicle
        </button>
      )}
      {state === "exiting" && (
        <p className="notice" aria-live="polite">
          Exiting vehicle...
        </p>
      )}
    </section>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("availability");
  const [session, setSession] = useState<AuthSession>();
  const [sessionState, setSessionState] = useState<SessionState>("loading");
  const [authError, setAuthError] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [availability, setAvailability] = useState<FacilityAvailabilityResponse>();
  const [viewState, setViewState] = useState<ViewState>("initial");
  const [error, setError] = useState("");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [reservationsState, setReservationsState] = useState<ReservationsState>("initial");
  const [reservationsError, setReservationsError] = useState("");
  const [createdReservation, setCreatedReservation] = useState<BookingResponse>();
  const [creationError, setCreationError] = useState("");
  const [cancellationCode, setCancellationCode] = useState<string>();
  const [cancellationSubmitting, setCancellationSubmitting] = useState(false);
  const [cancellationError, setCancellationError] = useState("");
  const [cancellationSuccess, setCancellationSuccess] = useState("");
  const [reservationDetailCode, setReservationDetailCode] = useState<string>();
  const [reservationDetail, setReservationDetail] = useState<Reservation>();
  const [reservationDetailState, setReservationDetailState] =
    useState<ReservationDetailState>("initial");
  const [reservationDetailError, setReservationDetailError] = useState("");
  const reservationDetailRequestId = useRef(0);
  const [paymentTxnId, setPaymentTxnId] = useState<string>();
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState<string>();
  const [paymentInitSubmitting, setPaymentInitSubmitting] = useState(false);
  const [paymentVerifySubmitting, setPaymentVerifySubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState("");

  useEffect(() => {
    const existing = getMemorySession();
    if (!existing) {
      setSessionState("unauthenticated");
      return;
    }

    void validateSession(existing);
  }, []);

  async function validateSession(existing: AuthSession): Promise<void> {
    try {
      const user = await getCurrentUser(existing.accessToken);
      const validSession = { ...existing, user };
      setMemorySession(validSession);
      setSession(validSession);
      setSessionState("authenticated");
    } catch (cause) {
      if (cause instanceof AuthApiError && cause.status === 401) {
        try {
          const renewed = await refresh({ refreshToken: existing.refreshToken });
          const user = await getCurrentUser(renewed.accessToken);
          const renewedSession = { ...renewed, user };
          setMemorySession(renewedSession);
          setSession(renewedSession);
          setSessionState("authenticated");
          return;
        } catch {
          // The access and refresh tokens are both unusable.
        }
      }
      clearMemorySession();
      setSession(undefined);
      setSessionState("unauthenticated");
      setScreen("availability");
      setCancellationCode(undefined);
      setCancellationSubmitting(false);
      setCancellationError("");
      setCancellationSuccess("");
      setAuthError("Your session has expired. Please sign in again.");
    }
  }

  async function handleAuthentication(nextSession: AuthSession): Promise<void> {
    setSessionState("loading");
    setAuthError("");
    setMemorySession(nextSession);
    try {
      const user = await getCurrentUser(nextSession.accessToken);
      const authenticated = { ...nextSession, user };
      setMemorySession(authenticated);
      setSession(authenticated);
      setSessionState("authenticated");
      setScreen("availability");
    } catch (cause) {
      clearMemorySession();
      setSession(undefined);
      setSessionState("unauthenticated");
      setAuthError(cause instanceof Error ? cause.message : "Unable to verify your session.");
    }
  }

  async function handleLogout(): Promise<void> {
    if (!session) return;
    setAuthError("");
    try {
      await logout(session);
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : "Unable to sign out cleanly.");
    } finally {
      reservationDetailRequestId.current += 1;
      clearMemorySession();
      setSession(undefined);
      setSessionState("unauthenticated");
      setScreen("availability");
      setCancellationCode(undefined);
      setCancellationSubmitting(false);
      setCancellationError("");
      setCancellationSuccess("");
      resetPaymentState();
    }
  }

  async function handleOpenReservations(): Promise<void> {
    if (sessionState !== "authenticated" || !session) return;
    setScreen("reservations");
    setReservationsState("loading");
    setReservationsError("");
    setReservations([]);
    setCancellationCode(undefined);
    setCancellationError("");
    setCancellationSuccess("");
    setReservationDetailCode(undefined);
    setReservationDetail(undefined);
    setReservationDetailState("initial");
    setReservationDetailError("");
    resetPaymentState();
    reservationDetailRequestId.current += 1;
    try {
      const result = await fetchReservations(session.accessToken);
      setReservations(result.reservations);
      setReservationsState("success");
    } catch (cause) {
      setReservationsState("error");
      setReservationsError(
        cause instanceof AuthApiError && cause.status === 401
          ? "You are not authorized to view reservations."
          : cause instanceof Error
            ? cause.message
            : "Unable to load your reservations.",
      );
    }
  }

  async function handleViewReservationDetails(code: string): Promise<void> {
    if (sessionState !== "authenticated" || !session) return;
    const requestId = ++reservationDetailRequestId.current;
    setReservationDetailCode(code);
    setReservationDetail(undefined);
    setReservationDetailState("loading");
    setReservationDetailError("");
    resetPaymentState();
    try {
      const result = await getReservation(session.accessToken, code);
      if (requestId !== reservationDetailRequestId.current) return;
      setReservationDetail(result.reservation);
      setReservationDetailState("success");
    } catch (cause) {
      if (requestId !== reservationDetailRequestId.current) return;
      setReservationDetailState("error");
      setReservationDetailError(reservationDetailErrorMessage(cause));
    }
  }

  function handleOpenOperatorDashboard(): void {
    if (sessionState !== "authenticated" || !session) return;
    if (!session.user.roles.includes("PARKING_OPERATOR")) return;
    setScreen("operator");
  }

  function handleOpenAdminDashboard(): void {
    if (sessionState !== "authenticated" || !session) return;
    if (!session.user.roles.includes("ADMIN")) return;
    setScreen("admin");
  }

  async function handleOperatorRegistered(_operator: Operator): Promise<void> {
    if (!session) return;
    const user = await getCurrentUser(session.accessToken);
    if (!user.roles.includes("PARKING_OPERATOR")) {
      throw new AuthApiError(
        "The server did not assign operator access after registration.",
        403,
        "FORBIDDEN",
      );
    }
    const updatedSession = { ...session, user };
    setMemorySession(updatedSession);
    setSession(updatedSession);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedId = facilityId.trim();
    if (!/^\d+$/.test(trimmedId) || Number(trimmedId) <= 0) {
      setAvailability(undefined);
      setError("Enter a valid positive facility ID.");
      setViewState("error");
      return;
    }

    setViewState("loading");
    setError("");
    setCreatedReservation(undefined);
    setCreationError("");
    try {
      setAvailability(await fetchFacilityAvailability(trimmedId));
      setViewState("success");
    } catch (cause) {
      setAvailability(undefined);
      setError(availabilityErrorMessage(cause));
      setViewState("error");
    }
  }

  function handleRequestCancellation(code: string): void {
    if (cancellationSubmitting) return;
    setCancellationCode(code);
    setCancellationError("");
    setCancellationSuccess("");
  }

  function handleKeepReservation(): void {
    if (cancellationSubmitting) return;
    setCancellationCode(undefined);
    setCancellationError("");
  }

  async function handleConfirmCancellation(): Promise<void> {
    if (!session || !cancellationCode || cancellationSubmitting) return;
    setCancellationSubmitting(true);
    setCancellationError("");
    try {
      const result = await cancelReservation(session.accessToken, cancellationCode);
      setReservations((current) =>
        current.map((reservation) =>
          reservation.reservationCode === cancellationCode ? result.reservation : reservation,
        ),
      );
      if (reservationDetailCode === cancellationCode) {
        setReservationDetail(result.reservation);
      }
      setCancellationCode(undefined);
      setCancellationError("");
      setCancellationSuccess(`Reservation ${cancellationCode} has been cancelled.`);
    } catch (cause) {
      if (cause instanceof AuthApiError && cause.code === "ALREADY_CANCELLED") {
        try {
          const refreshed = await fetchReservations(session.accessToken);
          setReservations(refreshed.reservations);
          setCancellationCode(undefined);
        } catch {
          // Preserve the current list if the authoritative refresh also fails.
        }
      }
      setCancellationError(cancellationErrorMessage(cause));
    } finally {
      setCancellationSubmitting(false);
    }
  }

  function resetPaymentState(): void {
    setPaymentTxnId(undefined);
    setPaymentIdempotencyKey(undefined);
    setPaymentInitSubmitting(false);
    setPaymentVerifySubmitting(false);
    setPaymentError("");
    setPaymentSuccess("");
  }

  async function handleInitiatePayment(): Promise<void> {
    if (
      sessionState !== "authenticated" ||
      !session ||
      !reservationDetail ||
      paymentInitSubmitting
    ) {
      return;
    }
    const idempotencyKey = paymentIdempotencyKey ?? generateIdempotencyKey();
    if (!paymentIdempotencyKey) {
      setPaymentIdempotencyKey(idempotencyKey);
    }
    setPaymentInitSubmitting(true);
    setPaymentError("");
    setPaymentSuccess("");
    try {
      const response = await initiatePayment(
        session.accessToken,
        reservationDetail.reservationCode,
        idempotencyKey,
      );
      setPaymentTxnId(response.payment.providerTxnId ?? undefined);
    } catch (cause) {
      setPaymentError(paymentErrorMessage(cause));
    } finally {
      setPaymentInitSubmitting(false);
    }
  }

  async function handleVerifyPayment(): Promise<void> {
    if (
      sessionState !== "authenticated" ||
      !session ||
      !reservationDetail ||
      !paymentTxnId ||
      paymentVerifySubmitting
    ) {
      return;
    }
    setPaymentVerifySubmitting(true);
    setPaymentError("");
    setPaymentSuccess("");
    try {
      const response = await verifyPayment(session.accessToken, paymentTxnId);
      setReservationDetail(response.reservation);
      setReservations((current) =>
        current.map((reservation) =>
          reservation.reservationCode === response.reservation.reservationCode
            ? response.reservation
            : reservation,
        ),
      );
      if (response.payment.status === "FAILED" || response.reservation.state === "FAILED") {
        setPaymentError("The payment failed and this reservation could not be confirmed.");
        return;
      }
      setPaymentSuccess(
        `Payment verified. Reservation ${response.reservation.reservationCode} is confirmed.`,
      );
    } catch (cause) {
      setPaymentError(paymentErrorMessage(cause));
    } finally {
      setPaymentVerifySubmitting(false);
    }
  }

  return (
    <main className="shell">
      <div className="page-width">
        <header className="topbar">
          <PlaceholderBanner />
          <nav className="nav" aria-label="Primary navigation">
            <button
              className={screen === "availability" ? "nav-button active" : "nav-button"}
              onClick={() => setScreen("availability")}
              type="button"
            >
              Availability
            </button>
            {sessionState === "authenticated" && session ? (
              <>
                <button
                  className={screen === "reservations" ? "nav-button active" : "nav-button"}
                  onClick={() => void handleOpenReservations()}
                  type="button"
                >
                  My Reservations
                </button>
                {session.user.roles.includes("PARKING_OPERATOR") && (
                  <button
                    className={screen === "operator" ? "nav-button active" : "nav-button"}
                    onClick={handleOpenOperatorDashboard}
                    type="button"
                  >
                    Operator Dashboard
                  </button>
                )}
                {session.user.roles.includes("ADMIN") && (
                  <button
                    className={screen === "admin" ? "nav-button active" : "nav-button"}
                    onClick={handleOpenAdminDashboard}
                    type="button"
                  >
                    Admin Control Panel
                  </button>
                )}
                {!session.user.roles.includes("PARKING_OPERATOR") && (
                  <button
                    className={
                      screen === "operator-registration" ? "nav-button active" : "nav-button"
                    }
                    onClick={() => setScreen("operator-registration")}
                    type="button"
                  >
                    Register as Operator
                  </button>
                )}
                <span className="user-label">{session.user.fullName || session.user.email}</span>
                <button className="nav-button" onClick={() => void handleLogout()} type="button">
                  Sign out
                </button>
              </>
            ) : (
              <>
                <button
                  className={screen === "login" ? "nav-button active" : "nav-button"}
                  onClick={() => {
                    setAuthError("");
                    setScreen("login");
                  }}
                  type="button"
                >
                  Sign in
                </button>
                <button
                  className={screen === "register" ? "nav-button active" : "nav-button"}
                  onClick={() => {
                    setAuthError("");
                    setScreen("register");
                  }}
                  type="button"
                >
                  Create account
                </button>
              </>
            )}
          </nav>
        </header>
        {sessionState === "loading" && (
          <p className="session-notice" aria-live="polite">
            Checking your session...
          </p>
        )}
        {authError && (
          <p className="notice error" role="alert">
            {authError}
          </p>
        )}
        {screen === "login" && sessionState !== "authenticated" && (
          <LoginForm
            loading={sessionState === "loading"}
            onSuccess={(result) => void handleAuthentication(result)}
            onError={setAuthError}
          />
        )}
        {screen === "register" && sessionState !== "authenticated" && (
          <RegisterForm
            loading={sessionState === "loading"}
            onSuccess={(result) => void handleAuthentication(result)}
            onError={setAuthError}
          />
        )}
        {screen === "reservations" && sessionState === "authenticated" && session ? (
          <ReservationsView
            accessToken={session.accessToken}
            cancellationCode={cancellationCode}
            cancellationError={cancellationError}
            cancellationSuccess={cancellationSuccess}
            cancellationSubmitting={cancellationSubmitting}
            data={{ reservations }}
            detail={reservationDetail}
            detailCode={reservationDetailCode}
            detailError={reservationDetailError}
            detailState={reservationDetailState}
            error={reservationsError}
            onConfirmCancellation={() => void handleConfirmCancellation()}
            onInitiatePayment={() => void handleInitiatePayment()}
            onKeepReservation={handleKeepReservation}
            onRequestCancellation={handleRequestCancellation}
            onVerifyPayment={() => void handleVerifyPayment()}
            onViewDetails={(code) => void handleViewReservationDetails(code)}
            paymentError={paymentError}
            paymentInitSubmitting={paymentInitSubmitting}
            paymentSuccess={paymentSuccess}
            paymentTxnId={paymentTxnId}
            paymentVerifySubmitting={paymentVerifySubmitting}
            state={reservationsState}
          />
        ) : screen === "operator" &&
          sessionState === "authenticated" &&
          session &&
          session.user.roles.includes("PARKING_OPERATOR") ? (
          <OperatorDashboard accessToken={session.accessToken} />
        ) : screen === "operator-registration" && sessionState === "authenticated" && session ? (
          <OperatorRegistration
            accessToken={session.accessToken}
            onOpenDashboard={handleOpenOperatorDashboard}
            onRegistered={handleOperatorRegistered}
          />
        ) : screen === "admin" &&
          sessionState === "authenticated" &&
          session &&
          session.user.roles.includes("ADMIN") ? (
          <AdminDashboard accessToken={session.accessToken} />
        ) : (
          <>
            <section className="intro" aria-labelledby="page-title">
              <p className="eyebrow">
                {MVP_STATUS} · {MODE_STATUS}
              </p>
              <h2 id="page-title">Know your parking before you arrive.</h2>
              <p className="tagline">{APP_TAGLINE}</p>
            </section>

            <section className="search-card" aria-labelledby="search-title">
              <div>
                <p className="section-kicker">Live availability</p>
                <h3 id="search-title">Check a parking facility</h3>
                <p className="muted">Availability is reported by the facility and may change.</p>
              </div>
              <form className="search-form" onSubmit={handleSubmit}>
                <label htmlFor="facility-id">Facility ID</label>
                <div className="search-controls">
                  <input
                    id="facility-id"
                    inputMode="numeric"
                    name="facilityId"
                    onChange={(event) => setFacilityId(event.target.value)}
                    placeholder="e.g. 1"
                    value={facilityId}
                  />
                  <button type="submit" disabled={viewState === "loading"}>
                    {viewState === "loading" ? "Loading..." : "Check availability"}
                  </button>
                </div>
              </form>
            </section>

            <div className="status-region" aria-live="polite" aria-busy={viewState === "loading"}>
              {viewState === "initial" && (
                <p className="notice">Enter a facility ID to view its current availability.</p>
              )}
              {viewState === "loading" && (
                <p className="notice">Loading facility availability...</p>
              )}
              {viewState === "error" && (
                <p className="notice error" role="alert">
                  {error}
                </p>
              )}
              {viewState === "success" && availability && (
                <>
                  <AvailabilityResult data={availability} />
                  {sessionState === "authenticated" &&
                    session &&
                    bookableSlots(availability).length > 0 && (
                      <ReservationCreation
                        accessToken={session.accessToken}
                        createdReservation={createdReservation}
                        error={creationError}
                        facilityId={Number(facilityId.trim())}
                        slots={bookableSlots(availability)}
                        onError={setCreationError}
                        onSuccess={setCreatedReservation}
                        onViewReservations={() => void handleOpenReservations()}
                      />
                    )}
                </>
              )}
            </div>
          </>
        )}

        <p className="meta">
          {APP_NAME} · v{APP_VERSION}
        </p>
      </div>
    </main>
  );
}

function ReservationsView({
  accessToken,
  cancellationCode,
  cancellationError,
  cancellationSuccess,
  cancellationSubmitting,
  data,
  detail,
  detailCode,
  detailError,
  detailState,
  error,
  onConfirmCancellation,
  onInitiatePayment,
  onKeepReservation,
  onRequestCancellation,
  onVerifyPayment,
  onViewDetails,
  paymentError,
  paymentInitSubmitting,
  paymentSuccess,
  paymentTxnId,
  paymentVerifySubmitting,
  state,
}: {
  accessToken: string;
  cancellationCode: string | undefined;
  cancellationError: string;
  cancellationSuccess: string;
  cancellationSubmitting: boolean;
  data: BookingListResponse;
  detail: Reservation | undefined;
  detailCode: string | undefined;
  detailError: string;
  detailState: ReservationDetailState;
  error: string;
  onConfirmCancellation: () => void;
  onInitiatePayment: () => void;
  onKeepReservation: () => void;
  onRequestCancellation: (code: string) => void;
  onVerifyPayment: () => void;
  onViewDetails: (code: string) => void;
  paymentError: string;
  paymentInitSubmitting: boolean;
  paymentSuccess: string;
  paymentTxnId: string | undefined;
  paymentVerifySubmitting: boolean;
  state: ReservationsState;
}) {
  return (
    <section className="reservations-view" aria-labelledby="reservations-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Account</p>
          <h2 id="reservations-title">My Reservations</h2>
        </div>
        <span className="reservation-count">
          {state === "success" ? `${data.reservations.length} total` : "Private history"}
        </span>
      </div>
      {detailCode && (
        <ReservationDetail
          accessToken={accessToken}
          code={detailCode}
          error={detailError}
          onInitiatePayment={onInitiatePayment}
          onVerifyPayment={onVerifyPayment}
          paymentError={paymentError}
          paymentInitSubmitting={paymentInitSubmitting}
          paymentSuccess={paymentSuccess}
          paymentTxnId={paymentTxnId}
          paymentVerifySubmitting={paymentVerifySubmitting}
          reservation={detail}
          state={detailState}
        />
      )}
      <div className="status-region" aria-live="polite" aria-busy={state === "loading"}>
        {state === "loading" && <p className="notice">Loading your reservations...</p>}
        {state === "error" && (
          <p className="notice error" role="alert">
            {error}
          </p>
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
        {state === "success" && data.reservations.length === 0 && (
          <p className="notice">You have no reservations yet.</p>
        )}
        {state === "success" && data.reservations.length > 0 && (
          <ul className="reservation-list">
            {data.reservations.map((reservation) => (
              <ReservationCard
                cancellationActive={cancellationCode === reservation.reservationCode}
                cancellationSubmitting={cancellationSubmitting}
                key={reservation.id}
                onConfirmCancellation={onConfirmCancellation}
                onKeepReservation={onKeepReservation}
                onRequestCancellation={onRequestCancellation}
                onViewDetails={onViewDetails}
                reservation={reservation}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ReservationDetail({
  accessToken,
  code,
  error,
  onInitiatePayment,
  onVerifyPayment,
  paymentError,
  paymentInitSubmitting,
  paymentSuccess,
  paymentTxnId,
  paymentVerifySubmitting,
  reservation,
  state,
}: {
  accessToken: string;
  code: string;
  error: string;
  onInitiatePayment: () => void;
  onVerifyPayment: () => void;
  paymentError: string;
  paymentInitSubmitting: boolean;
  paymentSuccess: string;
  paymentTxnId: string | undefined;
  paymentVerifySubmitting: boolean;
  reservation: Reservation | undefined;
  state: ReservationDetailState;
}) {
  return (
    <section className="reservation-detail" aria-labelledby="reservation-detail-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Authoritative record</p>
          <h3 id="reservation-detail-title">Reservation details</h3>
        </div>
        <span className="reservation-count">{code}</span>
      </div>
      {state === "loading" && (
        <p className="notice" aria-live="polite">
          Loading reservation details...
        </p>
      )}
      {state === "error" && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {state === "success" && reservation && (
        <>
          <dl className="reservation-detail-list">
            <div>
              <dt>Reservation code</dt>
              <dd>{reservation.reservationCode}</dd>
            </div>
            <div>
              <dt>Facility ID</dt>
              <dd>{reservation.facilityId}</dd>
            </div>
            {reservation.slotId !== null && (
              <div>
                <dt>Slot ID</dt>
                <dd>{reservation.slotId}</dd>
              </div>
            )}
            <div>
              <dt>Status</dt>
              <dd>{bookingStatusLabel(reservation.state)}</dd>
            </div>
            {reservation.amount !== null && (
              <div>
                <dt>Amount</dt>
                <dd>{formatCurrency(reservation.amount)}</dd>
              </div>
            )}
            {reservation.paymentStatus !== null && (
              <div>
                <dt>Payment status</dt>
                <dd>{statusLabel(reservation.paymentStatus)}</dd>
              </div>
            )}
            <div>
              <dt>Start time</dt>
              <dd>
                <time dateTime={reservation.startsAt}>{formatTimestamp(reservation.startsAt)}</time>
              </dd>
            </div>
            <div>
              <dt>End time</dt>
              <dd>
                <time dateTime={reservation.endsAt}>{formatTimestamp(reservation.endsAt)}</time>
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>
                <time dateTime={reservation.createdAt}>
                  {formatTimestamp(reservation.createdAt)}
                </time>
              </dd>
            </div>
            {reservation.confirmedAt && (
              <div>
                <dt>Confirmed</dt>
                <dd>
                  <time dateTime={reservation.confirmedAt}>
                    {formatTimestamp(reservation.confirmedAt)}
                  </time>
                </dd>
              </div>
            )}
            {reservation.cancelledAt && (
              <div>
                <dt>Cancelled</dt>
                <dd>
                  <time dateTime={reservation.cancelledAt}>
                    {formatTimestamp(reservation.cancelledAt)}
                  </time>
                </dd>
              </div>
            )}
            {reservation.cancelReason && (
              <div>
                <dt>Cancellation reason</dt>
                <dd>{reservation.cancelReason}</dd>
              </div>
            )}
          </dl>
          <ParkingSessionPanel
            accessToken={accessToken}
            key={reservation.reservationCode}
            reservation={reservation}
          />
          {reservation.state === "PENDING_PAYMENT" && (
            <div className="payment-actions" aria-live="polite">
              <p>Pay the pending amount to confirm this reservation.</p>
              {!paymentTxnId ? (
                <button disabled={paymentInitSubmitting} onClick={onInitiatePayment} type="button">
                  {paymentInitSubmitting ? "Initiating payment..." : "Pay"}
                </button>
              ) : (
                <>
                  <p>
                    <strong>Transaction ID:</strong> {paymentTxnId}
                  </p>
                  <p>Verify the payment to confirm this reservation.</p>
                  <button
                    disabled={paymentVerifySubmitting}
                    onClick={onVerifyPayment}
                    type="button"
                  >
                    {paymentVerifySubmitting ? "Verifying payment..." : "Verify Payment"}
                  </button>
                </>
              )}
            </div>
          )}
          {paymentError && (
            <p className="notice error" role="alert">
              {paymentError}
            </p>
          )}
          {paymentSuccess && (
            <p className="notice success" role="status">
              {paymentSuccess}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ReservationCard({
  cancellationActive,
  cancellationSubmitting,
  onConfirmCancellation,
  onKeepReservation,
  onRequestCancellation,
  onViewDetails,
  reservation,
}: {
  cancellationActive: boolean;
  cancellationSubmitting: boolean;
  onConfirmCancellation: () => void;
  onKeepReservation: () => void;
  onRequestCancellation: (code: string) => void;
  onViewDetails: (code: string) => void;
  reservation: Reservation;
}) {
  return (
    <li className="reservation-card">
      <div className="reservation-card-heading">
        <div>
          <p className="section-kicker">Reservation</p>
          <h3>{reservation.reservationCode}</h3>
        </div>
        <span className={`reservation-status state-${reservation.state.toLowerCase()}`}>
          {bookingStatusLabel(reservation.state)}
        </span>
      </div>
      <dl className="reservation-details">
        <div>
          <dt>Facility ID</dt>
          <dd>{reservation.facilityId}</dd>
        </div>
        {reservation.slotId !== null && (
          <div>
            <dt>Slot ID</dt>
            <dd>{reservation.slotId}</dd>
          </div>
        )}
        <div>
          <dt>Start time</dt>
          <dd>
            <time dateTime={reservation.startsAt}>{formatTimestamp(reservation.startsAt)}</time>
          </dd>
        </div>
        <div>
          <dt>End time</dt>
          <dd>
            <time dateTime={reservation.endsAt}>{formatTimestamp(reservation.endsAt)}</time>
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <time dateTime={reservation.createdAt}>{formatTimestamp(reservation.createdAt)}</time>
          </dd>
        </div>
      </dl>
      <button
        className="view-details-button"
        onClick={() => onViewDetails(reservation.reservationCode)}
        type="button"
      >
        View Details
      </button>
      {reservation.state === "CONFIRMED" && !cancellationActive && (
        <button
          className="cancel-reservation-button"
          onClick={() => onRequestCancellation(reservation.reservationCode)}
          type="button"
        >
          Cancel Reservation
        </button>
      )}
      {reservation.state === "CONFIRMED" && cancellationActive && (
        <div
          className="cancellation-confirmation"
          role="group"
          aria-labelledby={`cancel-title-${reservation.id}`}
          aria-busy={cancellationSubmitting}
        >
          <h4 id={`cancel-title-${reservation.id}`}>Cancel this reservation?</h4>
          <p>This action will cancel the reservation. Payment and refunds are not implemented.</p>
          <p>
            <strong>{reservation.reservationCode}</strong> · Facility {reservation.facilityId}
            {reservation.slotId !== null ? ` · Slot ${reservation.slotId}` : ""}
          </p>
          <p>
            <time dateTime={reservation.startsAt}>{formatTimestamp(reservation.startsAt)}</time> to{" "}
            <time dateTime={reservation.endsAt}>{formatTimestamp(reservation.endsAt)}</time>
          </p>
          {cancellationSubmitting && (
            <p className="cancellation-progress" aria-live="polite">
              Cancelling reservation...
            </p>
          )}
          <div className="cancellation-actions">
            <button disabled={cancellationSubmitting} onClick={onConfirmCancellation} type="button">
              {cancellationSubmitting ? "Cancelling..." : "Confirm Cancellation"}
            </button>
            <button
              className="secondary-button"
              disabled={cancellationSubmitting}
              onClick={onKeepReservation}
              type="button"
            >
              Keep Reservation
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function ReservationCreation({
  accessToken,
  createdReservation,
  error,
  facilityId,
  slots,
  onError,
  onSuccess,
  onViewReservations,
}: {
  accessToken: string;
  createdReservation: BookingResponse | undefined;
  error: string;
  facilityId: number;
  slots: ParkingSlot[];
  onError: (message: string) => void;
  onSuccess: (response: BookingResponse) => void;
  onViewReservations: () => void;
}) {
  const [slotId, setSlotId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!slotId) {
      onError("Choose an available slot.");
      return;
    }
    if (!startsAt || !endsAt) {
      onError("Enter both a start and end date/time.");
      return;
    }

    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      onError("Enter valid start and end date/time values.");
      return;
    }
    if (endDate.getTime() <= startDate.getTime()) {
      onError("End time must be after start time.");
      return;
    }

    setSubmitting(true);
    onError("");
    try {
      const response = await createReservation(accessToken, {
        facilityId,
        slotId: Number(slotId),
        startsAt: startDate.toISOString(),
        endsAt: endDate.toISOString(),
      });
      onSuccess(response);
    } catch (cause) {
      onError(reservationCreationError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="reservation-creation" aria-labelledby="reservation-creation-title">
      <div className="reservation-creation-heading">
        <div>
          <p className="section-kicker">Reserve a slot</p>
          <h3 id="reservation-creation-title">Create a reservation</h3>
        </div>
        <span className="reservation-facility">Facility {facilityId}</span>
      </div>
      <form className="reservation-form" onSubmit={handleSubmit} aria-busy={submitting}>
        <label htmlFor="reservation-slot">Slot</label>
        <select
          id="reservation-slot"
          required
          value={slotId}
          onChange={(event) => setSlotId(event.target.value)}
        >
          <option value="">Choose a slot</option>
          {slots.map((slot) => (
            <option key={slot.id} value={slot.id}>
              {slot.slotCode} · {statusLabel(slot.status)}
            </option>
          ))}
        </select>
        <label htmlFor="reservation-start">Start date and time</label>
        <input
          id="reservation-start"
          required
          type="datetime-local"
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
        />
        <label htmlFor="reservation-end">End date and time</label>
        <input
          id="reservation-end"
          required
          type="datetime-local"
          value={endsAt}
          onChange={(event) => setEndsAt(event.target.value)}
        />
        <button type="submit" disabled={submitting}>
          {submitting ? "Creating reservation..." : "Create reservation"}
        </button>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {createdReservation && (
        <div className="reservation-confirmation" role="status" aria-live="polite">
          <p className="section-kicker">Reservation confirmed</p>
          <h4>{createdReservation.reservation.reservationCode}</h4>
          <p>
            <strong>{statusLabel(createdReservation.reservation.state)}</strong> for slot{" "}
            {createdReservation.reservation.slotId} from{" "}
            <time dateTime={createdReservation.reservation.startsAt}>
              {formatTimestamp(createdReservation.reservation.startsAt)}
            </time>{" "}
            to{" "}
            <time dateTime={createdReservation.reservation.endsAt}>
              {formatTimestamp(createdReservation.reservation.endsAt)}
            </time>
            .
          </p>
          <button type="button" onClick={onViewReservations}>
            View My Reservations
          </button>
        </div>
      )}
    </section>
  );
}

function LoginForm({
  loading,
  onSuccess,
  onError,
}: {
  loading: boolean;
  onSuccess: (session: AuthSession) => void;
  onError: (message: string) => void;
}) {
  const [values, setValues] = useState<LoginRequest>({ email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = values.email.trim();
    if (!email || !email.includes("@") || !values.password) {
      onError("Enter a valid email and password.");
      return;
    }
    setSubmitting(true);
    onError("");
    try {
      onSuccess(await login({ email, password: values.password }));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="login-title">
      <p className="section-kicker">Welcome back</p>
      <h2 id="login-title">Sign in to SmartPark</h2>
      <form className="auth-form" onSubmit={handleSubmit} aria-busy={loading || submitting}>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          autoComplete="email"
          type="email"
          value={values.email}
          onChange={(event) => setValues({ ...values, email: event.target.value })}
        />
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          autoComplete="current-password"
          type="password"
          value={values.password}
          onChange={(event) => setValues({ ...values, password: event.target.value })}
        />
        <button type="submit" disabled={loading || submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </section>
  );
}

function RegisterForm({
  loading,
  onSuccess,
  onError,
}: {
  loading: boolean;
  onSuccess: (session: AuthSession) => void;
  onError: (message: string) => void;
}) {
  const [values, setValues] = useState<RegisterRequest>({ email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = values.email.trim();
    const fullName = values.fullName?.trim();
    const phone = values.phone?.trim();
    if (!email || !email.includes("@")) {
      onError("Enter a valid email address.");
      return;
    }
    if (values.password.length < 8 || values.password.length > 128) {
      onError("Password must be between 8 and 128 characters.");
      return;
    }
    if (phone && !/^(\+91[\s-]?)?[6-9]\d{9}$/.test(phone)) {
      onError("Enter a valid Indian phone number or leave it blank.");
      return;
    }
    setSubmitting(true);
    onError("");
    try {
      onSuccess(
        await register({
          email,
          password: values.password,
          ...(fullName ? { fullName } : {}),
          ...(phone ? { phone } : {}),
        }),
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Unable to create your account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="register-title">
      <p className="section-kicker">Pune MVP</p>
      <h2 id="register-title">Create your account</h2>
      <form className="auth-form" onSubmit={handleSubmit} aria-busy={loading || submitting}>
        <label htmlFor="register-name">
          Full name <span className="optional">(optional)</span>
        </label>
        <input
          id="register-name"
          autoComplete="name"
          type="text"
          value={values.fullName ?? ""}
          onChange={(event) => setValues({ ...values, fullName: event.target.value })}
        />
        <label htmlFor="register-email">Email</label>
        <input
          id="register-email"
          autoComplete="email"
          type="email"
          value={values.email}
          onChange={(event) => setValues({ ...values, email: event.target.value })}
        />
        <label htmlFor="register-phone">
          Phone <span className="optional">(optional)</span>
        </label>
        <input
          id="register-phone"
          autoComplete="tel"
          type="tel"
          value={values.phone ?? ""}
          onChange={(event) => setValues({ ...values, phone: event.target.value })}
        />
        <label htmlFor="register-password">Password</label>
        <input
          id="register-password"
          autoComplete="new-password"
          type="password"
          value={values.password}
          onChange={(event) => setValues({ ...values, password: event.target.value })}
        />
        <button type="submit" disabled={loading || submitting}>
          {submitting ? "Creating account..." : "Create account"}
        </button>
      </form>
    </section>
  );
}

function AvailabilityResult({ data }: { data: FacilityAvailabilityResponse }) {
  return (
    <section className="results" aria-labelledby="results-title">
      <div className="results-heading">
        <div>
          <p className="section-kicker">Facility {data.facilityId}</p>
          <h3 id="results-title">Parking availability</h3>
        </div>
        <span className={`live-pill ${data.isLive ? "live" : "not-live"}`}>
          {data.isLive ? "Live now" : "Not live"}
        </span>
      </div>

      <div className="metrics" aria-label="Availability summary">
        <div className="metric primary">
          <span>Available</span>
          <strong>{data.availableSlots}</strong>
        </div>
        <div className="metric">
          <span>Total slots</span>
          <strong>{data.totalSlots}</strong>
        </div>
        <div className="metric">
          <span>Confidence</span>
          <strong>{statusLabel(data.confidence)}</strong>
        </div>
      </div>

      <div className="details">
        <span>
          Last updated:{" "}
          <time dateTime={data.lastUpdatedAt}>{formatTimestamp(data.lastUpdatedAt)}</time>
        </span>
        <span>
          Source:{" "}
          {data.sources.length > 0 ? data.sources.map(statusLabel).join(", ") : "Not available"}
        </span>
      </div>
      <p className="disclaimer">{data.disclaimer}</p>

      <div className="slots-heading">
        <h4>Slot status</h4>
        <span>{data.totalSlots} reported</span>
      </div>
      {data.slots.length === 0 ? (
        <p className="empty-state">No slots are currently reported for this facility.</p>
      ) : (
        <ul className="slot-list">
          {data.slots.map((slot) => (
            <li key={slot.id}>
              <span className="slot-code">{slot.slotCode}</span>
              <span className={`slot-status status-${slot.status.toLowerCase()}`}>
                {statusLabel(slot.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
