/**
 * Password hashing (docs/SECURITY.md: argon2id — never plaintext, never logged).
 *
 * Uses @node-rs/argon2 (prebuilt argon2id) with OWASP-ish starting parameters.
 * The encoded string self-describes its parameters, so `verifyPassword` can
 * validate hashes produced with different parameter sets over time.
 */
import { Algorithm, hash, verify } from "@node-rs/argon2";

const HASH_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

export function verifyPassword(encoded: string, password: string): Promise<boolean> {
  return verify(encoded, password, HASH_OPTIONS);
}
