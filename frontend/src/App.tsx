import { useEffect, useState, type FormEvent } from "react";
import {
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  MODE_STATUS,
  MVP_STATUS,
  type FacilityAvailabilityResponse,
  type LoginRequest,
  type RegisterRequest,
} from "@smartpark/shared";
import PlaceholderBanner from "./components/PlaceholderBanner";
import { fetchFacilityAvailability } from "./api/availability";
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
type Screen = "availability" | "login" | "register";
type SessionState = "loading" | "authenticated" | "unauthenticated";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
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
    }
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
    try {
      setAvailability(await fetchFacilityAvailability(trimmedId));
      setViewState("success");
    } catch (cause) {
      setAvailability(undefined);
      setError(cause instanceof Error ? cause.message : "Unable to load availability.");
      setViewState("error");
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
          {viewState === "loading" && <p className="notice">Loading facility availability...</p>}
          {viewState === "error" && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {viewState === "success" && availability && <AvailabilityResult data={availability} />}
        </div>

        <p className="meta">
          {APP_NAME} · v{APP_VERSION}
        </p>
      </div>
    </main>
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
