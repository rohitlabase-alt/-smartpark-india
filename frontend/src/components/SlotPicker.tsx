import { SLOT_CATEGORY_LABELS, type ParkingSlot } from "@smartpark/shared";

export type SlotPickView = "available" | "all";

export function pickableSlots(slots: ParkingSlot[], view: SlotPickView): ParkingSlot[] {
  return slots.filter(
    (slot) =>
      slot.reservationsEnabled &&
      (view === "all" || slot.status === "AVAILABLE" || slot.status === "RESERVED"),
  );
}

export function slotTileClass(slot: ParkingSlot, selectedId: number | null): string {
  if (selectedId === slot.id) return "slot-tile selected";
  return `slot-tile ${slot.status === "AVAILABLE" ? "available" : ""} ${slot.status === "RESERVED" ? "booked" : ""} ${slot.status === "OCCUPIED" ? "occupied" : ""}`;
}

export function SlotPicker({
  slots,
  selectedId,
  selectableOnly,
  onSelect,
}: {
  slots: ParkingSlot[];
  selectedId: number | null;
  selectableOnly: boolean;
  onSelect: (slot: ParkingSlot) => void;
}) {
  const visible = pickableSlots(slots, selectableOnly ? "available" : "all");

  return (
    <div>
      <div className="slot-grid" role="listbox" aria-label="Available parking slots">
        {visible.map((slot) => {
          const selectable =
            !selectableOnly || slot.status === "AVAILABLE" || slot.status === "RESERVED";
          return (
            <button
              key={slot.id}
              type="button"
              role="option"
              aria-selected={selectedId === slot.id}
              className={slotTileClass(slot, selectedId)}
              disabled={selectableOnly && !selectable}
              onClick={() => onSelect(slot)}
            >
              <span>{slot.slotCode}</span>
              <small>
                {slot.vehicleType || "parking"}
                {slot.category !== "STANDARD" ? ` · ${SLOT_CATEGORY_LABELS[slot.category]}` : ""}
              </small>
            </button>
          );
        })}
      </div>
      {visible.length === 0 && !selectableOnly && (
        <p className="empty-state">No parking slots reported for this facility yet.</p>
      )}
      {visible.length === 0 && selectableOnly && (
        <p className="empty-state">No bookable slots are open right now.</p>
      )}
      <p className="slot-legend">
        <span className="lg-available">Available</span>
        <span className="lg-reserved">Reserved</span>
        <span className="lg-occupied">Occupied</span>
        <span className="lg-booked">Unavailable</span>
      </p>
    </div>
  );
}
