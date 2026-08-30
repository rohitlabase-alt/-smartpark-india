import { describe, expect, it } from "vitest";
import {
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  API_NAMESPACE,
  MVP_STATUS,
  MODE_STATUS,
} from "../src/index.js";

describe("@smartpark/shared meta", () => {
  it("exports base product constants", () => {
    expect(APP_NAME).toBe("SmartPark India");
    expect(MVP_STATUS).toBe("Pune MVP");
    expect(MODE_STATUS).toBe("Workspace Foundation");
    expect(APP_TAGLINE.length).toBeGreaterThan(0);
  });

  it("semver-shaped app version", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exposes the API namespace contract", () => {
    expect(API_NAMESPACE).toBe("/api/v1");
  });
});