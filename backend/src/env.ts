/**
 * Loads the repository-root .env file (where .env.example lives) regardless of
 * the process cwd. Workspace scripts run with cwd = backend/, but the canonical
 * dev env file is at the repo root. No-op when the file is absent.
 */
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

const rootEnvPath = fileURLToPath(new URL("../../.env", import.meta.url));
dotenv.config({ path: rootEnvPath });
