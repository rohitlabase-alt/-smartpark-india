/**
 * Customer vehicle-filter vocabulary. Matchers are driven by the REAL free-text
 * `vehicleType` labels operators assign to slots (e.g. "car", "bike", "ev"). A
 * facility only matches when its slot data contains a compatible type label, so
 * the filter never fabricates availability.
 */

export type VehicleKey = "car" | "bike" | "ev";

export interface VehicleFilterOption {
  key: VehicleKey;
  label: string;
}

export const VEHICLE_FILTER_OPTIONS: VehicleFilterOption[] = [
  { key: "car", label: "Car" },
  { key: "bike", label: "Bike" },
  { key: "ev", label: "EV" },
];

function normalizedTokens(vehicleType: string): string[] {
  return vehicleType
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
}

function hasToken(tokens: string[], want: string[]): boolean {
  return tokens.some((token) => want.includes(token));
}

export function vehicleTypeMatches(key: VehicleKey, vehicleType: string): boolean {
  const tokens = normalizedTokens(vehicleType);
  if (key === "car") {
    return hasToken(tokens, ["car", "auto", "sedan", "suv", "hatchback", "taxi", "cuv"]);
  }
  if (key === "bike") {
    return hasToken(tokens, ["bike", "bicycle", "cycle", "scooter", "motorcycle", "two"]);
  }
  return hasToken(tokens, ["ev", "electric", "charging", "ev-child"]);
}

/** True when at least one real slot vehicleType matches the filter key. */
export function facilityMatchesVehicle(availableVehicleTypes: string[], key: VehicleKey): boolean {
  return availableVehicleTypes.some((type) => vehicleTypeMatches(key, type));
}

export function vehicleTypeLabel(vehicleType: string): string {
  const trimmed = vehicleType.trim();
  if (!trimmed) return "vehicle";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
