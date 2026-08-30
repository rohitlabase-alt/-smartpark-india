/**
 * SmartPark IoT foundation (Phase 1B) — docs/IOT.md.
 *
 * IoT is OPTIONAL and never a hard dependency of the availability engine.
 * This module defines the vocabulary and the ingestion seam; concrete adapters
 * (Sensor, Camera, Gate, PMS/ANPR/RFID) plug in behind `OccupancySource`.
 */
export const OCCUPANCY_STATES = ["AVAILABLE", "OCCUPIED", "UNKNOWN"] as const;
export type OccupancyState = (typeof OCCUPANCY_STATES)[number];

/** Reported device-level status (docs/DATABASE.md reported_status vocabulary). */
export const REPORTED_STATUSES = ["AVAILABLE", "OCCUPIED", "ERROR"] as const;
export type ReportedStatus = (typeof REPORTED_STATUSES)[number];

export const DEVICE_STATUSES = ["ONLINE", "OFFLINE", "STALE", "ERROR"] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const SOURCE_TYPES = ["SENSOR", "CAMERA", "GATE", "MANUAL", "PMS", "ANPR", "RFID"] as const;
export type OccupancySourceType = (typeof SOURCE_TYPES)[number];

export interface OccupancyReading {
  /** Opaque reference to the physical space (slot/cell). No PII. */
  spaceRef: string;
  /** Facility reference the space belongs to. */
  facilityRef: string;
  reportedStatus: ReportedStatus;
  sourceType: OccupancySourceType;
  /** Stable id of the reporting device/actor (sensor id, gate id, operator id). */
  sourceId: string;
  deviceStatus?: DeviceStatus;
  /** When the device observed the state (device clock-derived). */
  observedAt: string;
  /** When the platform received the reading (set by ingestion). */
  receivedAt?: string;
}

/**
 * Ingestion seam (docs/IOT.md §7 "AvailabilitySource"). The availability
 * engine depends only on this interface; no concrete adapter is mandatory.
 */
export interface OccupancySource {
  readonly sourceType: OccupancySourceType;
  readonly sourceId: string;
  /** Read the current occupancy state at the given space. MUST NOT throw on transient failure. */
  read(spaceRef: string): Promise<OccupancyReading>;
}

/**
 * Manual operator update source — a REAL implementation of the interface used
 * from Phase 2 onwards (docs/IOT.md: platform fully functional with only
 * manual availability updates). Every other adapter (sensor/gate/camera/...)
 * implements the same interface.
 */
export class ManualOccupancySource implements OccupancySource {
  readonly sourceType = "MANUAL" as const;
  constructor(
    public readonly sourceId: string,
    private readonly reportedStatusBySpace: Map<string, ReportedStatus>,
  ) {}

  async read(spaceRef: string): Promise<OccupancyReading> {
    const reportedStatus = this.reportedStatusBySpace.get(spaceRef) ?? "ERROR";
    return {
      spaceRef,
      facilityRef: "<not-yet-scoped>",
      reportedStatus,
      sourceType: this.sourceType,
      sourceId: this.sourceId,
      observedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    };
  }
}
