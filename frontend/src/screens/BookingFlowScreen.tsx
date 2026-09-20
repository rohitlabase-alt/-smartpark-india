import { useEffect, useMemo, useState } from "react";
import {
  SLOT_CATEGORIES,
  SLOT_CATEGORY_LABELS,
  type FacilityAvailabilityResponse,
  type PublicParkingFacility,
  type Reservation,
  type SlotCategory,
} from "@smartpark/shared";
import { fetchFacilityAvailability } from "../api/availability";
import { initiatePayment, verifyPayment } from "../api/payments";
import { createReservation } from "../api/reservations";
import { getParkingSessionPass } from "../api/sessions";
import { AuthApiError } from "../api/auth";
import { ParkingPassQR } from "../components/ParkingPassQR";
import { SlotPicker } from "../components/SlotPicker";
import { StepProgress, SubPageHeader, ScreenError, ScreenLoader } from "../components/ui";
import { IconQrCode, IconShield, IconCheck } from "../components/icons";
import {
  bookedHours,
  formatDateTime,
  formatINR,
  formatTime,
  slotWindowLabel,
} from "../utils/format";
import { vehicleTypeLabel } from "../utils/vehicle";

type LoadState = "loading" | "success" | "error";
type Step = "slots" | "details" | "payment" | "pass";

const PAYMENT_METHODS = ["UPI", "Card", "NetBanking"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const DURATION_OPTIONS = [1, 2, 3, 4, 6, 8, 12];

const DEFAULT_DATE = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

function nextHourTime(): string {
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  const hours = String(now.getHours()).padStart(2, "0");
  return `${hours}:00`;
}

function combine(date: string, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const d = new Date(`${date}T00:00:00`);
  d.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return d;
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof AuthApiError) {
    if (cause.status === 401) return "Your session expired. Please sign in again.";
    return cause.message;
  }
  return cause instanceof Error ? cause.message : fallback;
}

interface BookingFlowScreenProps {
  facility: PublicParkingFacility;
  accessToken: string;
  onExit: () => void;
  onFinished: (reservation: Reservation) => void;
}

export function BookingFlowScreen({
  facility,
  accessToken,
  onExit,
  onFinished,
}: BookingFlowScreenProps) {
  const [step, setStep] = useState<Step>("slots");

  const [slotsState, setSlotsState] = useState<LoadState>("loading");
  const [slotsError, setSlotsError] = useState("");
  const [availability, setAvailability] = useState<FacilityAvailabilityResponse | null>(null);

  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);

  // Society/zoned-facility pickers: a zone narrows the slot set, a parking
  // type (slot category) further narrows it. Defaults mean "any" so
  // non-society facilities are unaffected.
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<SlotCategory | null>(null);

  const [date, setDate] = useState(DEFAULT_DATE());
  const [startTime, setStartTime] = useState(nextHourTime());
  const [duration, setDuration] = useState(2);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("UPI");
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [passToken, setPassToken] = useState<string | undefined>();
  const [passLoading, setPassLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setSlotsState("loading");
      setSlotsError("");
      try {
        const data = await fetchFacilityAvailability(facility.id);
        if (cancelled) return;
        setAvailability(data);
        setSlotsState("success");
      } catch (cause) {
        if (cancelled) return;
        setSlotsError(errorMessage(cause, "Unable to load availability for this facility."));
        setSlotsState("error");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [facility.id]);

  const zones = availability?.zones ?? [];

  const zoneSlots = useMemo(() => {
    const slots = availability?.slots ?? [];
    return selectedZoneId === null ? slots : slots.filter((s) => s.zoneId === selectedZoneId);
  }, [availability, selectedZoneId]);

  const categoryOptions = useMemo(() => {
    const present = new Set(zoneSlots.map((s) => s.category));
    return SLOT_CATEGORIES.filter((c) => present.has(c));
  }, [zoneSlots]);

  const visibleSlots = useMemo(
    () =>
      selectedCategory === null
        ? zoneSlots
        : zoneSlots.filter((s) => s.category === selectedCategory),
    [zoneSlots, selectedCategory],
  );

  const selectedSlot = useMemo(
    () => visibleSlots.find((slot) => slot.id === selectedSlotId) ?? null,
    [visibleSlots, selectedSlotId],
  );

  // Drop the stale slot selection when the zone/parking-type filters hide it.
  useEffect(() => {
    if (selectedSlotId !== null && !visibleSlots.some((slot) => slot.id === selectedSlotId)) {
      setSelectedSlotId(null);
    }
  }, [visibleSlots, selectedSlotId]);

  const endsAt = useMemo(() => {
    const start = combine(date, startTime);
    const end = new Date(start.getTime() + duration * 3_600_000);
    return end;
  }, [date, startTime, duration]);

  const previewAmount = useMemo(
    () =>
      bookedHours(combine(date, startTime).toISOString(), endsAt.toISOString()) *
      facility.hourlyRate,
    [date, startTime, endsAt, facility.hourlyRate],
  );

  const availabilityPercent =
    availability && availability.totalSlots > 0
      ? Math.round((availability.availableSlots / availability.totalSlots) * 100)
      : 0;

  /** One initiate + verify cycle; the mock provider always reaches a final state. */
  async function verifyPaymentFor(createdReservation: Reservation): Promise<Reservation> {
    const initiated = await initiatePayment(accessToken, createdReservation.reservationCode);
    const verified = await verifyPayment(accessToken, initiated.payment.providerTxnId!);
    return verified.reservation;
  }

  async function handleReserveNow() {
    if (!selectedSlot) return;
    setBusy(true);
    setActionError("");
    setActionNotice("");
    try {
      const created = await createReservation(accessToken, {
        facilityId: facility.id,
        zoneId: selectedSlot.zoneId ?? undefined,
        slotId: selectedSlot.id,
        startsAt: combine(date, startTime).toISOString(),
        endsAt: endsAt.toISOString(),
      });
      setReservation(created.reservation);
      setPaymentMethod("UPI");
      setStep("payment");
    } catch (cause) {
      setActionError(errorMessage(cause, "Unable to create your reservation."));
    } finally {
      setBusy(false);
    }
  }

  async function handlePay() {
    if (!reservation || paymentConfirmed) return;
    setBusy(true);
    setActionError("");
    setActionNotice("");
    try {
      const updated = await verifyPaymentFor(reservation);
      setReservation(updated);
      if (updated.state === "CONFIRMED") {
        setPaymentConfirmed(true);
        setActionNotice("Payment verified. Your pass is ready.");
      } else {
        setActionNotice("Payment could not be confirmed. The booking has been marked failed.");
      }
    } catch (cause) {
      setActionError(errorMessage(cause, "Payment verification failed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevealPass() {
    if (!reservation || passToken) return;
    setPassLoading(true);
    setActionError("");
    try {
      const pass = await getParkingSessionPass(accessToken, reservation.reservationCode);
      setPassToken(pass.verificationToken);
    } catch (cause) {
      setActionError(errorMessage(cause, "Unable to load your parking pass."));
    } finally {
      setPassLoading(false);
    }
  }

  const stepNumber = step === "slots" ? 1 : step === "details" ? 2 : step === "payment" ? 3 : 4;

  return (
    <div className="sp-main sp-main--no-nav sp-shell--subpage">
      <SubPageHeader
        onBack={() => {
          if (step === "slots") onExit();
          else if (step === "payment" || step === "pass") onExit();
          else setStep("slots");
        }}
        title={
          step === "pass"
            ? "Parking Pass"
            : step === "payment"
              ? "Confirm & pay"
              : step === "details"
                ? "Booking details"
                : facility.name
        }
      />
      <StepProgress step={stepNumber} total={4} />

      {actionError && <ScreenError message={actionError} />}
      {actionNotice && (
        <p className="notice success" role="status">
          {actionNotice}
        </p>
      )}

      {step === "slots" && (
        <section aria-label="Choose a slot">
          <div className="summary-card">
            <div className="facility-card-top">
              <div>
                <h3 className="facility-card-title">{facility.name}</h3>
                <p className="facility-card-code">{facility.parkingId}</p>
              </div>
              <span className="rate-pill">{formatINR(facility.hourlyRate)}/hr</span>
            </div>
            <p className="facility-card-location">
              {facility.area ?? facility.city} · {facility.city}
            </p>
            {slotsState === "success" && availability && availability.totalSlots > 0 && (
              <div className="availability-bar" aria-hidden="true">
                <span
                  className="availability-bar-fill"
                  style={{ width: `${availabilityPercent}%` }}
                />
              </div>
            )}
            <div className="facility-card-stats">
              <span className="stat-label">
                {availability?.isLive ? <span className="live-dot" aria-hidden="true" /> : null}
                {availability
                  ? `${availability.availableSlots} open of ${availability.totalSlots}`
                  : "Loading live availability"}
              </span>
            </div>
          </div>

          {slotsState === "loading" && (
            <ScreenLoader label={`Checking ${facility.name} availability...`} />
          )}
          {slotsState === "error" && (
            <>
              <ScreenError message={slotsError} />
              <button type="button" onClick={() => onExit()}>
                Back to facilities
              </button>
            </>
          )}
          {slotsState === "success" && availability && (
            <>
              {zones.length > 0 && (
                <div className="section-heading">
                  <div>
                    <p className="section-kicker">Zone</p>
                    <h2>Where in {facility.name}?</h2>
                  </div>
                </div>
              )}
              {zones.length > 0 && (
                <div className="chip-row" role="group" aria-label="Zone filter">
                  <button
                    type="button"
                    className={`chip${selectedZoneId === null ? " selected" : ""}`}
                    onClick={() => setSelectedZoneId(null)}
                  >
                    All zones
                  </button>
                  {zones.map((zone) => (
                    <button
                      key={zone.id}
                      type="button"
                      className={`chip${selectedZoneId === zone.id ? " selected" : ""}`}
                      onClick={() => setSelectedZoneId(zone.id)}
                    >
                      {zone.name}
                    </button>
                  ))}
                </div>
              )}
              {categoryOptions.length > 1 && (
                <>
                  <div className="section-heading">
                    <div>
                      <p className="section-kicker">Parking type</p>
                      <h2>Pick a parking type</h2>
                    </div>
                  </div>
                  <div className="chip-row" role="group" aria-label="Parking type filter">
                    <button
                      type="button"
                      className={`chip${selectedCategory === null ? " selected" : ""}`}
                      onClick={() => setSelectedCategory(null)}
                    >
                      All types
                    </button>
                    {categoryOptions.map((category) => (
                      <button
                        key={category}
                        type="button"
                        className={`chip${selectedCategory === category ? " selected" : ""}`}
                        onClick={() => setSelectedCategory(category)}
                      >
                        {SLOT_CATEGORY_LABELS[category]}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Pick your spot</p>
                  <h2>Select a slot</h2>
                </div>
              </div>
              <SlotPicker
                slots={visibleSlots}
                selectedId={selectedSlotId}
                selectableOnly
                onSelect={(slot) => setSelectedSlotId(slot.id)}
              />
              {availability.disclaimer && <p className="disclaimer">{availability.disclaimer}</p>}
              {selectedSlot && (
                <div className="summary-card">
                  <div className="summary-row">
                    <span>Selected</span>
                    <strong>
                      {selectedSlot.slotCode} · {vehicleTypeLabel(selectedSlot.vehicleType)}
                    </strong>
                  </div>
                  <div className="summary-row">
                    <span>Parking type</span>
                    <strong>{SLOT_CATEGORY_LABELS[selectedSlot.category]}</strong>
                  </div>
                  {selectedSlot.zoneName && (
                    <div className="summary-row">
                      <span>Zone</span>
                      <strong>{selectedSlot.zoneName}</strong>
                    </div>
                  )}
                  <button
                    className="btn"
                    style={{ width: "100%", marginTop: 12 }}
                    type="button"
                    onClick={() => setStep("details")}
                  >
                    Book this spot
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {step === "details" && selectedSlot && (
        <section aria-label="Booking details">
          <div className="summary-card">
            <div className="summary-row">
              <dt>Facility</dt>
              <dd>{facility.name}</dd>
            </div>
            <div className="summary-row">
              <dt>Slot</dt>
              <dd>{selectedSlot.slotCode}</dd>
            </div>
            {selectedSlot.zoneName && (
              <div className="summary-row">
                <dt>Zone</dt>
                <dd>{selectedSlot.zoneName}</dd>
              </div>
            )}
            <div className="summary-row">
              <dt>Parking type</dt>
              <dd>{SLOT_CATEGORY_LABELS[selectedSlot.category]}</dd>
            </div>
            <label htmlFor="booking-date">Date</label>
            <input
              id="booking-date"
              type="date"
              value={date}
              min={DEFAULT_DATE()}
              onChange={(event) => setDate(event.target.value || DEFAULT_DATE())}
            />
            <label htmlFor="booking-start">Entry time</label>
            <input
              id="booking-start"
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value || nextHourTime())}
            />
            <label htmlFor="booking-duration">Duration</label>
            <div className="chip-row">
              {DURATION_OPTIONS.map((hours) => (
                <button
                  key={hours}
                  type="button"
                  className={`chip${duration === hours ? " selected" : ""}`}
                  onClick={() => setDuration(hours)}
                >
                  {hours}h
                </button>
              ))}
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-row">
              <dt>Entry</dt>
              <dd>{formatDateTime(combine(date, startTime).toISOString())}</dd>
            </div>
            <div className="summary-row">
              <dt>Exit</dt>
              <dd>{formatDateTime(endsAt.toISOString())}</dd>
            </div>
            <div className="summary-row">
              <dt>Duration</dt>
              <dd>
                {bookedHours(combine(date, startTime).toISOString(), endsAt.toISOString())} hr
              </dd>
            </div>
            <div className="summary-row">
              <dt>Rate</dt>
              <dd>{formatINR(facility.hourlyRate)}/hr</dd>
            </div>
            <div className="summary-total">
              <span>Estimated total</span>
              <strong>{formatINR(previewAmount)}</strong>
            </div>
            <p className="disclaimer">
              Final amount is confirmed by the platform when you reserve.
            </p>
            <button
              className="btn"
              style={{ width: "100%", marginTop: 10 }}
              type="button"
              disabled={!date || !startTime}
              onClick={() => void handleReserveNow()}
            >
              {busy ? "Reserving..." : "Reserve now"}
            </button>
          </div>
        </section>
      )}

      {step === "payment" && reservation && (
        <section aria-label="Payment">
          <div className="summary-card">
            <div className="summary-row">
              <dt>Booking</dt>
              <dd>{reservation.reservationCode}</dd>
            </div>
            <div className="summary-row">
              <dt>Facility</dt>
              <dd>{facility.name}</dd>
            </div>
            <div className="summary-row">
              <dt>Slot</dt>
              <dd>{selectedSlot?.slotCode ?? `Slot #${reservation.slotId ?? "—"}`}</dd>
            </div>
            <div className="summary-row">
              <dt>Window</dt>
              <dd>{slotWindowLabel(reservation.startsAt, reservation.endsAt)}</dd>
            </div>
            {reservation.amount !== null && (
              <div className="summary-total">
                <span>Charged amount</span>
                <strong>{formatINR(reservation.amount)}</strong>
              </div>
            )}
            {reservation.paymentStatus && (
              <div className="summary-row">
                <dt>Payment</dt>
                <dd>{reservation.paymentStatus}</dd>
              </div>
            )}
          </div>
          <div className="section-heading">
            <p className="section-kicker">Checkout</p>
            <h2>Select a payment method</h2>
          </div>
          <div className="chip-row" role="group" aria-label="Payment method">
            {PAYMENT_METHODS.map((method) => (
              <button
                key={method}
                type="button"
                role="option"
                className={`chip${paymentMethod === method ? " selected" : ""}`}
                aria-pressed={paymentMethod === method}
                disabled={busy}
                onClick={() => setPaymentMethod(method)}
              >
                {method}
              </button>
            ))}
          </div>
          <p className="disclaimer">
            Selected method: <strong>{paymentMethod}</strong>. Charged amount is fixed by the
            platform (facility rate × hours); you cannot edit it here.
          </p>
          {busy ? (
            <ScreenLoader label="Processing payment with SmartPay..." />
          ) : paymentConfirmed ? (
            <>
              <button
                className="btn"
                style={{ width: "100%" }}
                type="button"
                onClick={() => setStep("pass")}
              >
                <IconCheck width={20} height={20} /> View parking pass
              </button>
              {reservation.state !== "CONFIRMED" && (
                <ScreenError message="Your payment succeeded but the booking could not be confirmed. Please contact support." />
              )}
            </>
          ) : (
            <>
              <button
                className="btn"
                style={{ width: "100%" }}
                type="button"
                onClick={() => void handlePay()}
              >
                Pay {reservation.amount !== null ? formatINR(reservation.amount) : ""} & confirm
              </button>
              <div className="summary-card">
                <div className="summary-row">
                  <dt>Secure</dt>
                  <dd>SmartPay · Mock gateway</dd>
                </div>
              </div>
              <p className="disclaimer">
                Payment is processed by the SmartPark payment service; pass tokens are issued only
                after verification.
              </p>
            </>
          )}
        </section>
      )}

      {step === "pass" && reservation && (
        <section aria-label="Parking pass">
          <div className="pass-hero">
            <p className="pass-facility">{facility.name}</p>
            <p className="pass-code">{reservation.reservationCode}</p>
            <div className="pass-meta">
              <span>
                Slot <strong>{selectedSlot?.slotCode ?? `#${reservation.slotId ?? "—"}`}</strong>
              </span>
              <span>
                Entry <strong>{formatTime(reservation.startsAt)}</strong>
              </span>
              <span>
                Exit <strong>{formatTime(reservation.endsAt)}</strong>
              </span>
            </div>
            {reservation.amount !== null && (
              <p className="pass-meta" style={{ marginTop: 12 }}>
                <span>
                  Paid <strong>{formatINR(reservation.amount)}</strong>
                </span>
                <span>
                  Status <strong>{reservation.state}</strong>
                </span>
              </p>
            )}
          </div>

          {!passToken && (
            <div className="pass-card">
              <p className="pass-token-note">
                Your digital pass unlocks entry at the facility gate. Operators scan it to verify
                your booking and release your spot.
              </p>
              <button
                className="btn"
                style={{ width: "100%" }}
                type="button"
                disabled={passLoading}
                onClick={() => void handleRevealPass()}
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
              <p className="pass-token-note">
                Show this QR at the gate on {formatTime(reservation.startsAt)}. It can only be
                generated for confirmed bookings.
              </p>
              <p className="pass-token" aria-label="Parking pass token">
                {passToken}
              </p>
            </div>
          )}

          <div className="summary-card">
            <div className="summary-row">
              <dt>Trust</dt>
              <dd>
                <IconShield width={17} height={17} style={{ verticalAlign: -3 }} /> Verified booking
              </dd>
            </div>
            <div className="summary-row">
              <dt>What now?</dt>
              <dd>Arrive and scan at the operator gate</dd>
            </div>
          </div>

          <button
            className="btn"
            style={{ width: "100%", marginTop: 14 }}
            type="button"
            onClick={() => onFinished(reservation)}
          >
            <IconCheck width={20} height={20} /> Done
          </button>
        </section>
      )}
    </div>
  );
}
