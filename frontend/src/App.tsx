import { useState, type FormEvent } from "react";
import {
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  MODE_STATUS,
  MVP_STATUS,
  type FacilityAvailabilityResponse,
} from "@smartpark/shared";
import PlaceholderBanner from "./components/PlaceholderBanner";
import { fetchFacilityAvailability } from "./api/availability";

type ViewState = "initial" | "loading" | "success" | "error";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export default function App() {
  const [facilityId, setFacilityId] = useState("");
  const [availability, setAvailability] = useState<FacilityAvailabilityResponse>();
  const [viewState, setViewState] = useState<ViewState>("initial");
  const [error, setError] = useState("");

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
        <PlaceholderBanner />
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
