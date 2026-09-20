import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

beforeAll(async () => {
  server = createApp({
    corsOrigins: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
    ],
  }).listen(0);
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
        "Access-Control-Request-Headers": "authorization,content-type,idempotency-key",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Idempotency-Key");
  });

  it("allows the Vite auto-advanced dev port 5174 (fallback when 5173 is busy)", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "http://localhost:5174", Authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5174");

    const loopback = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "http://127.0.0.1:5174", Authorization: "Bearer test-token" },
    });
    expect(loopback.status).toBe(200);
    expect(loopback.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5174");
  });

  it("allows the 127.0.0.1 dev origins (IPv4 loopback mirrors)", async () => {
    for (const origin of ["http://127.0.0.1:5173", "http://127.0.0.1:5174"]) {
      const res = await fetch(`${baseUrl}/health`, {
        headers: { Origin: origin },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);

      const preflight = await fetch(`${baseUrl}/api/v1/parking/1/availability`, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
      expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
    }
  });

  it("does not regress CORS on the public parking facilities endpoint (DB-backed route)", async () => {
    // Facilities is a DB-backed route; this harness has no database, so the
    // real browser contract is the preflight + ACAO header, not a DB-less 200.

    const preflight = await fetch(`${baseUrl}/api/v1/parking/facilities`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5174",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:5174");
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");

    const res = await fetch(`${baseUrl}/api/v1/parking/facilities`, {
      headers: { Origin: "http://localhost:5174", Authorization: "Bearer test-token" },
    });
    // Without a DB this route errors, but the CORS gate must still emit the
    // allowlisted origin header (the divergent case: it must NOT echo a 5173 =>
    // mismatch on the ACAO for 5174) so the browser keeps the response.
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5174");

    const denied = await fetch(`${baseUrl}/api/v1/parking/facilities`, {
      headers: { Origin: "http://localhost:9999", Authorization: "Bearer test-token" },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
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
