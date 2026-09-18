import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicParkingFacility, Reservation } from "@smartpark/shared";
import { cancelReservation, fetchReservations } from "../api/reservations";
import { initiatePayment, verifyPayment } from "../api/payments";
import { exitParking, getParkingSessionByReservation } from "../api/sessions";
import { AuthApiError } from "../api/auth";
import {
  AppHeader,
  SectionHeading,
  ScreenError,
  ScreenLoader,
  EmptyState,
  StatusBadge,
} from "../components/ui";
import { formatINR, slotWindowLabel } from "../utils/format";

type LoadState = "loading" | "success" | "error";
type BookingTab = "upcoming" | "active" | "completed" | "cancelled";

interface BookingsScreenProps {
  accessToken: string;
  facilities: PublicParkingFacility[];
  onViewPass: (reservation: Reservation) => void;
  onSignIn: () => void;
}

function facilityName(facilities: PublicParkingFacility[], facilityId: number): string {
  return facilities.find((f) => f.id === facilityId)?.name ?? `Parking facility #${facilityId}`;
}

function tabsFor(reservations: Reservation[]): BookingTab[] {
  const has = (state: string, states: string[]) => states.includes(state);
  const upcoming = reservations.some((r) => has(r.state, ["PENDING_PAYMENT", "CONFIRMED"]));
  const active = reservations.some((r) => r.state === "ACTIVE");
  const completed = reservations.some((r) => r.state === "COMPLETED");
  const cancelled = reservations.some((r) => has(r.state, ["CANCELLED", "EXPIRED", "FAILED"]));
  return (
    [
      upcoming ? "upcoming" : null,
      active ? "active" : null,
      completed ? "completed" : null,
      cancelled ? "cancelled" : null,
    ] as (BookingTab | null)[]
  ).filter((t) => t !== null) as BookingTab[];
}

const EMPTY_COPY: Record<BookingTab, string> = {
  upcoming: "No upcoming bookings yet. Find a parking spot to book one.",
  active: "You have no active parking sessions. Your booking becomes active at the gate.",
  completed: "No completed parking sessions yet.",
  cancelled: "No cancelled bookings.",
};

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401) return "Your session expired. Please sign in again.";
    return cause.message;
  }
  return cause instanceof Error ? cause.message : fallback;
}

export function BookingsScreen({
  accessToken,
  facilities,
  onViewPass,
  onSignIn,
}: BookingsScreenProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [tab, setTab] = useState<BookingTab>("upcoming");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (token: string) => {
    const id = ++requestId.current;
    setState("loading");
    setError("");
    try {
      const data = await fetchReservations(token);
      if (id !== requestId.current) return;
      setReservations(data.reservations);
      setState("success");
    } catch (cause) {
      if (id !== requestId.current) return;
      setState("error");
      setError(errorMessage(cause, "Unable to load your bookings."));
    }
  }, []);

  useEffect(() => {
    void load(accessToken);
    return () => {
      requestId.current += 1;
    };
  }, [accessToken, load]);

  const availableTabs = tabsFor(reservations);
  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.includes(tab)) {
      setTab(availableTabs[0]!);
    }
  }, [availableTabs, tab]);

  const visible = reservations.filter((r) => {
    if (tab === "upcoming") return r.state === "PENDING_PAYMENT" || r.state === "CONFIRMED";
    if (tab === "active") return r.state === "ACTIVE";
    if (tab === "completed") return r.state === "COMPLETED";
    return ["CANCELLED", "EXPIRED", "FAILED"].includes(r.state);
  });

  async function runAction(reservation: Reservation, action: () => Promise<void>) {
    setBusyId(reservation.id);
    setActionError("");
    setActionSuccess("");
    try {
      await action();
      setActionSuccess((current) => (current === "" ? "Done." : current));
    } catch (cause) {
      setActionError(errorMessage(cause, "The action could not be completed."));
    } finally {
      setBusyId(null);
    }
  }

  function handlePayNow(reservation: Reservation) {
    void runAction(reservation, async () => {
      const initiated = await initiatePayment(accessToken, reservation.reservationCode);
      await verifyPayment(accessToken, initiated.payment.providerTxnId!);
      await load(accessToken);
      setActionSuccess("Payment confirmed. Your booking is now active.");
    });
  }

  function handleCancel(reservation: Reservation) {
    void runAction(reservation, async () => {
      await cancelReservation(accessToken, reservation.reservationCode);
      setConfirmCancelId(null);
      await load(accessToken);
    });
  }

  function handleExit(reservation: Reservation) {
    void runAction(reservation, async () => {
      const session = await getParkingSessionByReservation(
        accessToken,
        reservation.reservationCode,
      );
      await exitParking(accessToken, session.session.id);
      await load(accessToken);
      setActionSuccess("Vehicle exited. Thanks for parking with SmartPark!");
    });
  }

  if (!accessToken) {
    return (
      <div className="sp-main">
        <AppHeader />
        <SectionHeading kicker="Bookings" title="Your bookings" />
        <EmptyState message="Sign in to see your bookings and parking passes." />
        <button className="btn" style={{ width: "100%" }} type="button" onClick={onSignIn}>
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="sp-main">
      <AppHeader />
      <SectionHeading kicker="Bookings" title="Your bookings" />
      {availableTabs.length > 0 && (
        <div className="tab-bar" role="tablist" aria-label="Booking filters">
          {availableTabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`tab${tab === key ? " selected" : ""}`}
              onClick={() => setTab(key)}
            >
              {key[0]!.toUpperCase() + key.slice(1)}
            </button>
          ))}
        </div>
      )}

      {actionError && <ScreenError message={actionError} />}
      {actionSuccess && (
        <p className="notice success" role="status">
          {actionSuccess}
        </p>
      )}

      {state === "loading" && <ScreenLoader label="Loading your bookings..." />}
      {state === "error" && (
        <>
          <ScreenError message={error} />
          <button className="secondary-button" type="button" onClick={() => void load(accessToken)}>
            Try again
          </button>
        </>
      )}
      {state === "success" && reservations.length === 0 && (
        <EmptyState message="You have no bookings yet. Find parking to make your first one." />
      )}
      {state === "success" && reservations.length > 0 && visible.length === 0 && (
        <EmptyState message={EMPTY_COPY[tab]} />
      )}
      {state === "success" && visible.length > 0 && (
        <div className="booking-list">
          {visible.map((reservation) => (
            <BookingCard
              key={reservation.id}
              reservation={reservation}
              facilityName={facilityName(facilities, reservation.facilityId)}
              busy={busyId === reservation.id}
              confirmCancel={confirmCancelId === reservation.id}
              onRequestCancel={() => setConfirmCancelId(reservation.id)}
              onKeepCancel={() => setConfirmCancelId(null)}
              onCancel={() => handleCancel(reservation)}
              onPay={() => handlePayNow(reservation)}
              onViewPass={() => onViewPass(reservation)}
              onExit={() => handleExit(reservation)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BookingCard({
  reservation,
  facilityName,
  busy,
  confirmCancel,
  onRequestCancel,
  onKeepCancel,
  onCancel,
  onPay,
  onViewPass,
  onExit,
}: {
  reservation: Reservation;
  facilityName: string;
  busy: boolean;
  confirmCancel: boolean;
  onRequestCancel: () => void;
  onKeepCancel: () => void;
  onCancel: () => void;
  onPay: () => void;
  onViewPass: () => void;
  onExit: () => void;
}) {
  const state = reservation.state;
  const label: Record<string, string> = {
    PENDING_PAYMENT: "Awaiting payment",
    CONFIRMED: "Confirmed",
    ACTIVE: "Parked",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    EXPIRED: "Expired",
    FAILED: "Failed",
  };

  return (
    <article className="booking-card">
      <div className="booking-card-head">
        <div>
          <h3 className="booking-card-title">{facilityName}</h3>
          <p className="booking-code">{reservation.reservationCode}</p>
        </div>
        <StatusBadge label={label[state] ?? state} tone={`state-${state.toLowerCase()}`} />
      </div>
      <div className="summary-row">
        <dt>Window</dt>
        <dd>{slotWindowLabel(reservation.startsAt, reservation.endsAt)}</dd>
      </div>
      {reservation.amount !== null && (
        <div className="summary-row">
          <dt>Amount</dt>
          <dd>{formatINR(reservation.amount)}</dd>
        </div>
      )}
      {reservation.cancelReason && (
        <div className="summary-row">
          <dt>Reason</dt>
          <dd>{reservation.cancelReason}</dd>
        </div>
      )}

      {confirmCancel && (state === "CONFIRMED" || state === "PENDING_PAYMENT") ? (
        <div
          className="summary-card"
          style={{ marginTop: 12, boxShadow: "none", border: "1px solid var(--sp-line)" }}
        >
          <p style={{ fontWeight: 700, marginBottom: 8 }}>Cancel this booking?</p>
          <div className="cancellation-actions">
            <button type="button" disabled={busy} onClick={onCancel}>
              {busy ? "Cancelling..." : "Yes, cancel"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={onKeepCancel}
            >
              Keep booking
            </button>
          </div>
        </div>
      ) : (
        <div className="booking-card-actions">
          {state === "PENDING_PAYMENT" && (
            <button type="button" disabled={busy} onClick={onPay}>
              {busy ? "Paying..." : "Pay & confirm"}
            </button>
          )}
          {state === "CONFIRMED" && (
            <>
              <button type="button" disabled={busy} onClick={onViewPass}>
                View pass
              </button>
              <button
                className="cancel-reservation-button"
                type="button"
                disabled={busy}
                onClick={onRequestCancel}
              >
                Cancel
              </button>
            </>
          )}
          {state === "ACTIVE" && (
            <button type="button" disabled={busy} onClick={onExit}>
              {busy ? "Exiting..." : "Exit parking"}
            </button>
          )}
          {["CANCELLED", "EXPIRED", "FAILED", "COMPLETED"].includes(state) && (
            <span className="muted" style={{ fontSize: "0.82rem", padding: "12px 0" }}>
              This booking is {label[state]?.toLowerCase()}.
            </span>
          )}
        </div>
      )}
    </article>
  );
}
