import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

beforeAll(async () => {
  // Inject a deterministic readiness probe so the test never depends on a
  // live postgres. Both outcomes (ready/not_ready) are exercised directly.
  server = createApp({
    checkDatabaseReady: async () => false,
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

describe("GET /ready (dependency not ready)", () => {
  it("returns 503 not_ready when the database is unavailable", async () => {
    const res = await fetch(`${baseUrl}/ready`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      services: { postgres: string };
    };
    expect(body.status).toBe("not_ready");
    expect(body.services.postgres).toBe("unavailable");
  });
});

describe("GET /ready (dependency ready)", () => {
  it("returns 200 ready when the database answers", async () => {
    const readyApp = createApp({ checkDatabaseReady: async () => true });
    const readyServer = readyApp.listen(0);
    await new Promise<void>((resolve) => readyServer.once("listening", resolve));
    try {
      const { port } = readyServer.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/ready`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        services: { postgres: string };
      };
      expect(body.status).toBe("ready");
      expect(body.services.postgres).toBe("ok");
    } finally {
      await new Promise<void>((resolve) => readyServer.close(() => resolve()));
    }
  });
});
