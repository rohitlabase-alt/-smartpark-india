import { useEffect, useState, type FormEvent } from "react";
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
  type ParkingSlot,
  type Reservation,
  type RegisterRequest,
} from "@smartpark/shared";
import PlaceholderBanner from "./components/PlaceholderBanner";
import OperatorDashboard from "./OperatorDashboard";
import OperatorRegistration from "./OperatorRegistration";
import { fetchFacilityAvailability } from "./api/availability";
import { cancelReservation, createReservation, fetchReservations } from "./api/reservations";
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
  "availability" | "login" | "register" | "reservations" | "operator" | "operator-registration";
type SessionState = "loading" | "authenticated" | "unauthenticated";
type ReservationsState = "initial" | "loading" | "success" | "error";

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
        return "This facility is no longer available.";
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
      clearMemorySession();
      setSession(undefined);
      setSessionState("unauthenticated");
      setScreen("availability");
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

  function handleOpenOperatorDashboard(): void {
    if (sessionState !== "authenticated" || !session) return;
    if (!session.user.roles.includes("PARKING_OPERATOR")) return;
    setScreen("operator");
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
      setError(cause instanceof Error ? cause.message : "Unable to load availability.");
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
            cancellationCode={cancellationCode}
            cancellationError={cancellationError}
            cancellationSuccess={cancellationSuccess}
            cancellationSubmitting={cancellationSubmitting}
            data={{ reservations }}
            error={reservationsError}
            onConfirmCancellation={() => void handleConfirmCancellation()}
            onKeepReservation={handleKeepReservation}
            onRequestCancellation={handleRequestCancellation}
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
  cancellationCode,
  cancellationError,
  cancellationSuccess,
  cancellationSubmitting,
  data,
  error,
  onConfirmCancellation,
  onKeepReservation,
  onRequestCancellation,
  state,
}: {
  cancellationCode: string | undefined;
  cancellationError: string;
  cancellationSuccess: string;
  cancellationSubmitting: boolean;
  data: BookingListResponse;
  error: string;
  onConfirmCancellation: () => void;
  onKeepReservation: () => void;
  onRequestCancellation: (code: string) => void;
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
                reservation={reservation}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ReservationCard({
  cancellationActive,
  cancellationSubmitting,
  onConfirmCancellation,
  onKeepReservation,
  onRequestCancellation,
  reservation,
}: {
  cancellationActive: boolean;
  cancellationSubmitting: boolean;
  onConfirmCancellation: () => void;
  onKeepReservation: () => void;
  onRequestCancellation: (code: string) => void;
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
