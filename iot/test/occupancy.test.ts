import { describe, expect, it } from "vitest";
import { ManualOccupancySource, OCCUPANCY_STATES } from "../src/occupancy.js";

describe("manual occupancy source (IoT optionality)", () => {
  it("reports configured availability for a space", async () => {
    const source = new ManualOccupancySource("operator-42", new Map([["slot-A", "OCCUPIED"]]));
    const reading = await source.read("slot-A");
    expect(reading.reportedStatus).toBe("OCCUPIED");
    expect(reading.sourceType).toBe("MANUAL");
    expect(reading.sourceId).toBe("operator-42");
    expect(reading.spaceRef).toBe("slot-A");
  });

  it("falls back to ERROR status for unknown spaces (transient-failure contract)", async () => {
    const source = new ManualOccupancySource("operator-42", new Map());
    const reading = await source.read("unknown-slot");
    expect(reading.reportedStatus).toBe("ERROR");
  });

  it("exposes only documented occupancy states", () => {
    expect(OCCUPANCY_STATES).toEqual(["AVAILABLE", "OCCUPIED", "UNKNOWN"]);
  });
});
