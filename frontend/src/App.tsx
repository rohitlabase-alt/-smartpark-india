import { useEffect, useState } from "react";
import type { Operator, PublicParkingFacility, Reservation } from "@smartpark/shared";
import { BottomNavigation, type AppTab } from "./components/BottomNavigation";
import { AppHeader, ScreenLoader, SubPageHeader } from "./components/ui";
import { HomeScreen } from "./screens/HomeScreen";
import { FindParkingScreen } from "./screens/FindParkingScreen";
import { BookingsScreen } from "./screens/BookingsScreen";
import { PassScreen } from "./screens/PassScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { AuthScreen } from "./screens/AuthScreen";
import { BookingFlowScreen } from "./screens/BookingFlowScreen";
import OperatorDashboard from "./OperatorDashboard";
import AdminDashboard from "./AdminDashboard";
import OperatorRegistration from "./OperatorRegistration";
import { usePublicFacilities } from "./hooks/usePublicFacilities";
import {
  AuthApiError,
  clearMemorySession,
  getCurrentUser,
  getMemorySession,
  logout,
  refresh,
  setMemorySession,
  type AuthSession,
} from "./api/auth";
import { APP_NAME, APP_VERSION } from "@smartpark/shared";

type SessionState = "loading" | "authenticated" | "unauthenticated";

export default function App() {
  const [tab, setTab] = useState<AppTab>("home");
  const [session, setSession] = useState<AuthSession>();
  const [sessionState, setSessionState] = useState<SessionState>("loading");

  const [bookingFacility, setBookingFacility] = useState<PublicParkingFacility | null>(null);
  const [pendingFacility, setPendingFacility] = useState<PublicParkingFacility | null>(null);

  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [operatorRegOpen, setOperatorRegOpen] = useState(false);
  const [focusPassCode, setFocusPassCode] = useState<string | undefined>();
  const [info, setInfo] = useState<{ title: string; body: string } | null>(null);
  const [authError, setAuthError] = useState("");

  const facilitiesListing = usePublicFacilities();

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
      const valid = { ...existing, user };
      setMemorySession(valid);
      setSession(valid);
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
          // Both tokens are unusable; fall through to a clean sign-out.
        }
      }
      clearMemorySession();
      setSession(undefined);
      setSessionState("unauthenticated");
      setAuthError("Your session has expired. Please sign in again.");
    }
  }

  function openAuth(mode: "login" | "register"): void {
    setAuthError("");
    setAuthMode(mode);
    setAuthOpen(true);
  }

  function closeAuth(): void {
    setAuthOpen(false);
    setPendingFacility(null);
  }

  function handleTab(t: AppTab): void {
    setFocusPassCode(undefined);
    setTab(t);
  }

  function handleOpenFacility(facility: PublicParkingFacility): void {
    if (sessionState === "authenticated" && session) {
      setBookingFacility(facility);
    } else {
      setPendingFacility(facility);
      openAuth("login");
    }
  }

  async function handleAuthenticated(nextSession: AuthSession): Promise<void> {
    setAuthOpen(false);
    try {
      const user = await getCurrentUser(nextSession.accessToken);
      const authenticated = { ...nextSession, user };
      setMemorySession(authenticated);
      setSession(authenticated);
      setSessionState("authenticated");
      setAuthError("");
      if (pendingFacility) {
        setBookingFacility(pendingFacility);
        setPendingFacility(null);
      }
    } catch (cause) {
      clearMemorySession();
      setSession(undefined);
      setSessionState("unauthenticated");
      setAuthError(cause instanceof Error ? cause.message : "Unable to verify your session.");
    }
  }

  async function handleSignOut(): Promise<void> {
    if (session) {
      try {
        await logout(session);
      } catch {
        // Best-effort server sign-out; local clearing continues regardless.
      }
    }
    clearMemorySession();
    setSession(undefined);
    setSessionState("unauthenticated");
    setBookingFacility(null);
    setOperatorOpen(false);
    setAdminOpen(false);
    setOperatorRegOpen(false);
    setTab("home");
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
    const updated = { ...session, user };
    setMemorySession(updated);
    setSession(updated);
  }

  function handleViewPass(reservation: Reservation): void {
    setFocusPassCode(reservation.reservationCode);
    setTab("pass");
  }

  function closeBooking(): void {
    setBookingFacility(null);
  }

  function handleBookingFinished(reservation: Reservation): void {
    setBookingFacility(null);
    setFocusPassCode(reservation.reservationCode);
    setTab("pass");
  }

  if (sessionState === "loading") {
    return (
      <div className="sp-shell">
        <AppHeader />
        <div className="sp-main sp-main--no-nav" style={{ paddingTop: 40 }}>
          <ScreenLoader label="Checking your session..." />
        </div>
      </div>
    );
  }

  return (
    <div className="sp-shell">
      {authError && (
        <p className="notice error" role="alert" style={{ margin: "12px auto 0", maxWidth: 520 }}>
          {authError}
        </p>
      )}

      {bookingFacility && session ? (
        <BookingFlowScreen
          facility={bookingFacility}
          accessToken={session.accessToken}
          onExit={closeBooking}
          onFinished={handleBookingFinished}
        />
      ) : operatorOpen && session ? (
        <div className="sp-main sp-main--no-nav sp-shell--subpage">
          <SubPageHeader onBack={() => setOperatorOpen(false)} title="Parking Operations" />
          <OperatorDashboard accessToken={session.accessToken} />
        </div>
      ) : adminOpen && session ? (
        <div className="sp-main sp-main--no-nav sp-shell--subpage">
          <SubPageHeader onBack={() => setAdminOpen(false)} title="Admin Console" />
          <AdminDashboard accessToken={session.accessToken} />
        </div>
      ) : operatorRegOpen && session ? (
        <div className="sp-main sp-main--no-nav sp-shell--subpage">
          <SubPageHeader onBack={() => setOperatorRegOpen(false)} title="Operator Access" />
          <OperatorRegistration
            accessToken={session.accessToken}
            onOpenDashboard={() => {
              setOperatorRegOpen(false);
              setOperatorOpen(true);
            }}
            onRegistered={handleOperatorRegistered}
          />
        </div>
      ) : authOpen ? (
        <div className="sp-main sp-main--no-nav sp-shell--subpage">
          <AuthScreen
            mode={authMode}
            loading={false}
            onSwitchMode={setAuthMode}
            onBack={closeAuth}
            onAuthenticated={(response) => handleAuthenticated(response)}
          />
        </div>
      ) : info ? (
        <div className="sp-main sp-main--no-nav sp-shell--subpage">
          <SubPageHeader onBack={() => setInfo(null)} title={info.title} />
          <InfoBody body={info.body} />
        </div>
      ) : (
        <>
          {tab === "home" && (
            <HomeScreen
              user={session?.user}
              onTab={handleTab}
              onOpenFacility={handleOpenFacility}
            />
          )}
          {tab === "find" && <FindParkingScreen onOpenFacility={handleOpenFacility} />}
          {tab === "bookings" && (
            <BookingsScreen
              accessToken={session?.accessToken ?? ""}
              facilities={facilitiesListing.facilities}
              onViewPass={handleViewPass}
              onSignIn={() => openAuth("login")}
            />
          )}
          {tab === "pass" && (
            <PassScreen
              accessToken={session?.accessToken ?? ""}
              facilities={facilitiesListing.facilities}
              focusCode={focusPassCode}
              onSignIn={() => openAuth("login")}
              onFind={() => handleTab("find")}
            />
          )}
          {tab === "profile" && (
            <ProfileScreen
              user={session?.user}
              onTab={handleTab}
              onSignIn={() => openAuth("login")}
              onRegister={() => openAuth("register")}
              onSignOut={() => void handleSignOut()}
              onOpenOperator={() => setOperatorOpen(true)}
              onOpenOperatorRegistration={() => setOperatorRegOpen(true)}
              onOpenAdmin={() => setAdminOpen(true)}
              onOpenInfo={(title, body) => setInfo({ title, body })}
            />
          )}

          <BottomNavigation active={tab} onSelect={handleTab} />
        </>
      )}

      <p className="meta" aria-hidden="true">
        {APP_NAME} · v{APP_VERSION}
      </p>
    </div>
  );
}

function InfoBody({ body }: { body: string }) {
  return (
    <div className="summary-card" style={{ boxShadow: "none" }}>
      {body.split("\n\n").map((paragraph, index) => (
        <p key={index} className="muted" style={{ marginBottom: 12 }}>
          {paragraph}
        </p>
      ))}
    </div>
  );
}
