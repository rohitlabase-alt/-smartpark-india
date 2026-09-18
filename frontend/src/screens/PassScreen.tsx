import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicParkingFacility, Reservation } from "@smartpark/shared";
import { fetchReservations } from "../api/reservations";
import { getParkingSessionPass } from "../api/sessions";
import { AuthApiError } from "../api/auth";
import { ParkingPassQR } from "../components/ParkingPassQR";
import {
  AppHeader,
  SectionHeading,
  ScreenError,
  ScreenLoader,
  EmptyState,
  StatusBadge,
} from "../components/ui";
import { IconQrCode, IconShield } from "../components/icons";
import { formatINR, formatTime } from "../utils/format";

type LoadState = "loading" | "success" | "error";

interface PassScreenProps {
  accessToken: string;
  facilities: PublicParkingFacility[];
  focusCode?: string;
  onSignIn: () => void;
  onFind: () => void;
}

function facilityName(facilities: PublicParkingFacility[], facilityId: number): string {
  return facilities.find((f) => f.id === facilityId)?.name ?? `Parking facility #${facilityId}`;
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401) return "Your session expired. Please sign in again.";
    return cause.message;
  }
  return cause instanceof Error ? cause.message : fallback;
}

export function PassScreen({
  accessToken,
  facilities,
  focusCode,
  onSignIn,
  onFind,
}: PassScreenProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | undefined>(focusCode);
  const [passToken, setPassToken] = useState<string | undefined>();
  const [passLoading, setPassLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const requestId = useRef(0);

  const load = useCallback(async (token: string) => {
    const id = ++requestId.current;
    setState("loading");
    setError("");
    try {
      const data = await fetchReservations(token);
      if (id !== requestId.current) return;
      const passes = data.reservations.filter(
        (r) => r.state === "CONFIRMED" || r.state === "ACTIVE",
      );
      setReservations(passes);
      setState("success");
    } catch (cause) {
      if (id !== requestId.current) return;
      setState("error");
      setError(errorMessage(cause, "Unable to load your parking passes."));
    }
  }, []);

  useEffect(() => {
    void load(accessToken);
    return () => {
      requestId.current += 1;
    };
  }, [accessToken, load]);

  useEffect(() => {
    setPassToken(undefined);
    setTokenError("");
  }, [selectedCode]);

  useEffect(() => {
    if (focusCode) setSelectedCode(focusCode);
  }, [focusCode]);

  const selected =
    reservations.find((r) => r.reservationCode === selectedCode) ?? reservations[0] ?? undefined;

  async function handleReveal() {
    if (!selected || passToken) return;
    setPassLoading(true);
    setTokenError("");
    try {
      const pass = await getParkingSessionPass(accessToken, selected.reservationCode);
      setPassToken(pass.verificationToken);
    } catch (cause) {
      setTokenError(errorMessage(cause, "Unable to load your parking pass."));
    } finally {
      setPassLoading(false);
    }
  }

  if (!accessToken) {
    return (
      <div className="sp-main">
        <AppHeader />
        <SectionHeading kicker="Pass" title="Parking pass" />
        <EmptyState message="Sign in to access your digital parking pass." />
        <button className="btn" style={{ width: "100%" }} type="button" onClick={onSignIn}>
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="sp-main">
      <AppHeader />
      <SectionHeading kicker="Pass" title="Parking pass" />

      {state === "loading" && <ScreenLoader label="Loading your passes..." />}
      {state === "error" && (
        <>
          <ScreenError message={error} />
          <button className="secondary-button" type="button" onClick={() => void load(accessToken)}>
            Try again
          </button>
        </>
      )}
      {state === "success" && reservations.length === 0 && (
        <>
          <EmptyState message="You have no active passes yet. Book a parking spot to get your digital pass." />
          <button className="btn" style={{ width: "100%" }} type="button" onClick={onFind}>
            Find parking
          </button>
        </>
      )}

      {state === "success" && reservations.length > 0 && selected && (
        <>
          {reservations.length > 1 && (
            <div className="chip-row" role="group" aria-label="Choose a pass">
              {reservations.map((r) => (
                <button
                  key={r.reservationCode}
                  type="button"
                  className={`chip${selected.reservationCode === r.reservationCode ? " selected" : ""}`}
                  onClick={() => setSelectedCode(r.reservationCode)}
                >
                  {r.reservationCode}
                </button>
              ))}
            </div>
          )}

          <div className="pass-hero">
            <StatusBadge label={selected.state} tone={`state-${selected.state.toLowerCase()}`} />
            <p className="pass-facility" style={{ marginTop: 10 }}>
              {facilityName(facilities, selected.facilityId)}
            </p>
            <p className="pass-code">{selected.reservationCode}</p>
            <div className="pass-meta">
              <span>
                Slot{" "}
                <strong>{selected.slotId ? `#${selected.slotId}` : "Assigned at entry"}</strong>
              </span>
              <span>
                Entry <strong>{formatTime(selected.startsAt)}</strong>
              </span>
              <span>
                Exit <strong>{formatTime(selected.endsAt)}</strong>
              </span>
            </div>
            {selected.amount !== null && (
              <div className="pass-meta" style={{ marginTop: 12 }}>
                <span>
                  Paid <strong>{formatINR(selected.amount)}</strong>
                </span>
                <span>
                  Status <strong>{selected.state}</strong>
                </span>
              </div>
            )}
          </div>

          {tokenError && <ScreenError message={tokenError} />}

          {!passToken && (
            <div className="pass-card">
              <p className="pass-token-note">
                Show this pass at the facility gate. Operators scan it to verify your booking and
                release your spot. Tokens are generated on demand for confirmed bookings only.
              </p>
              <button
                className="btn"
                style={{ width: "100%" }}
                type="button"
                disabled={passLoading}
                onClick={() => void handleReveal()}
              >
                <IconQrCode width={20} height={20} />
                {passLoading ? "Preparing your pass..." : "Show parking pass"}
              </button>
            </div>
          )}
          {passToken && (
            <div className="pass-card">
              <div className="parking-pass-qr-wrap">
                <ParkingPassQR value={passToken} label="Parking pass QR code" />
              </div>
              <p className="pass-token" aria-label="Parking pass token">
                {passToken}
              </p>
            </div>
          )}

          <div className="summary-card">
            <div className="summary-row">
              <dt>Trust</dt>
              <dd>
                <IconShield width={17} height={17} style={{ verticalAlign: -3 }} /> Verified pass
              </dd>
            </div>
            <div className="summary-row">
              <dt>Validity</dt>
              <dd>Until {formatTime(selected.endsAt)}</dd>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
