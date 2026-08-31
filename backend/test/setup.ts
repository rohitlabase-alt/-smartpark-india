/**
 * Vitest setup (backend only). Runs before every test file in the worker.
 *
 * Points the API at a THROWAWAY postgres database (smartpark_test) so DB-backed
 * tests never touch dev data, and gives auth operations a test-only JWT secret.
 * Requires the docker compose postgres from `npm run infra:up` (or any postgres
 * reachable at TEST_DATABASE_URL).
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://smartpark:smartpark@localhost:5432/smartpark_test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? "test-only-jwt-secret-please-change-9f2c1a8e7b6d5c4f3a2b";
