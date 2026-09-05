import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

beforeAll(async () => {
  server = createApp({ corsOrigins: ["http://localhost:5173"] }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("GET /health", () => {
  it("returns 200 with the health contract", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      service: string;
      version: string;
      timestamp: string;
    };
    expect(body.status).toBe("ok");
    expect(body.service).toContain("SmartPark India");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it("allows the local frontend origin and bearer preflight headers", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "http://localhost:5173", Authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("vary")).toContain("Origin");

    const preflight = await fetch(`${baseUrl}/api/v1/parking/1/availability`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("does not allow an unconfigured origin", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();

    const preflight = await fetch(`${baseUrl}/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("basic error handling", () => {
  it("returns JSON 404 for unknown routes", async () => {
    const res = await fetch(`${baseUrl}/no-such-route`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns JSON content type", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
