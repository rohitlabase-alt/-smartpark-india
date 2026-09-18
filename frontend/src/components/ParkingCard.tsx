import type { PublicParkingFacility } from "@smartpark/shared";
import { formatINR, relativeLastUpdated } from "../utils/format";
import { IconChevronRight, IconMapPin } from "./icons";

export function ParkingCard({
  facility,
  onSelect,
}: {
  facility: PublicParkingFacility;
  onSelect: () => void;
}) {
  const pct =
    facility.totalSlots > 0 ? Math.round((facility.availableSlots / facility.totalSlots) * 100) : 0;
  const empty = facility.availableSlots === 0 && facility.totalSlots > 0;
  const liveText = facility.isLive
    ? facility.availableSlots === 0
      ? "Parking full"
      : `${facility.availableSlots} open`
    : "No live data";

  return (
    <button className="facility-card" type="button" onClick={onSelect}>
      <div className="facility-card-body">
        <div className="facility-card-top">
          <div>
            <h3 className="facility-card-title">{facility.name}</h3>
            <p className="facility-card-code">{facility.parkingId}</p>
          </div>
          <span className="rate-pill">{formatINR(facility.hourlyRate)}/hr</span>
        </div>
        <p className="facility-card-location">
          <IconMapPin />
          <span>{[facility.area, facility.city].filter(Boolean).join(", ") || facility.city}</span>
        </p>
        <div className="availability-bar" aria-hidden="true">
          <span
            className="availability-bar-fill"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>
        <div className="facility-card-stats">
          <span className="stat-label">
            <strong className={empty ? "" : ""}>{liveText}</strong>
          </span>
          <span className="stat-label">
            {facility.availableSlots}/{facility.totalSlots} spots
          </span>
          <span className="stat-label">
            {facility.isLive ? "Live" : "Updated " + relativeLastUpdated(facility.lastUpdatedAt)}
          </span>
        </div>
      </div>
      <div className="facility-card-cta">
        <span>View slots</span>
        <IconChevronRight width={18} height={18} />
      </div>
    </button>
  );
}
