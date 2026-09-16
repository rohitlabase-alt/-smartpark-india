# SmartPark India — Security Model (V1)

Status: DRAFT v0.1
Last updated: 2026-08-30
Scope: design-time threat model + required controls for the Pune MVP prototype.

> Security is mandatory throughout. This file describes what we protect against and how, and what must be tested before a feature is "done".

---

## 1. Threat Model (V1)

### 1.1 Assets
- User accounts (credentials, PII).
- Reservation rights (tokens/QRs = value).
- Operator facility data.
- Availability integrity (spoofed/stale data attacks the UX & trust).
- Audit logs.
- Blockchain verifier/registrar key(s).
- Backend secrets (DB creds, JWT secret, provider keys).

### 1.2 Threat actors
- Opportunistic attackers (scanners, bots, credential stuffing).
- Malicious users (double-booking fraud, token sharing, IDOR probing).
- Malicious operators/gate staff (privilege misuse, QR forgery).
- IoT spoofers (fake telemetry to poison availability).
- Insider (admin) misuse — mitigated by audit + least privilege.

### 1.3 Required protection matrix

| Threat | Mitigation (V1) |
|---|---|
| Reentrancy | Contracts: no external calls in state changes, CEI pattern (see BLOCKCHAIN.md) |
| Access-control bugs | RBAC middleware at every route; role scoping per facility; contract role map |
| Double booking | DB exclusion constraint + row locks + transactional reserve flow; tests |
| Token replay | Single-use status machine; used/expired tokens rejected at gate |
| QR forgery | QR encodes a signed JWT (HMAC, server secret) validated server-side; on-chain reference cross-check |
| Expired tokens | Window validated at verification time + keeper marks EXPIRED |
| Unauthorized entry | Gate endpoints RBAC-scoped per facility + audit record |
| Signature replay | No EIP-712 in V1 (no replay surface); design notes for later |
| API abuse / rate-limit bypass | Per-route rate limits keyed by IP/user/device; tested |
| SQL injection | Parameterized queries / ORM; no string-built SQL; zod validation on inputs |
| XSS | React default escaping; CSP headers; no `dangerouslySetInnerHTML`; sanitize rich text |
| CSRF | JWT in Authorization header (not cookie) for API; refresh token in httpOnly cookie with SameSite=Strict + origin checks |
| IDOR | Ownership checks (user can only see own reservations/tokens; operator only own facilities); IDs are opaque codes; tests assert 404 on foreign resources |
| JWT/session attacks | Short-lived access tokens, rotation on refresh, revocation list, audited login; clear algorithm, strong secret via env |
| Secret leakage | `.env` gitignored; `SECRETS.md` scan; no secrets in frontend bundle; CI secret scan |
| IoT spoofing | DeviceId + per-device credential; reject unauthenticated telemetry; device status STALE/ERROR |
| Stale IoT data | Confidence/freshness model (HIGH/MEDIUM_LOW...) and honest availability display |
| Privilege escalation | RBAC + role-scoped handlers; no client-trusted role claims; gate staff restricted permissions |
| Credential stuffing | Rate limits, lockout on repeated failure, bcrypt/argon2 hashing, audit |
| Payment abuse | Mock provider only in V1 (no money); idempotency keys; no card storage |

---

## 2. Authentication & Sessions

- Password hashing: argon2id (or bcrypt cost 12+) — never plaintext.
- Access JWT: ~30 min, `alg` pinned, audience/payload minimal.
- Refresh token: random, hashed at rest, httpOnly + Secure + SameSite=Lax/Strict cookie, rotated every use, revocable.
- Optional MFA/OTP deferred but interface-ready.

## 3. Authorization (RBAC)

Roles: `USER, GATE_STAFF, PARKING_OPERATOR, OPERATOR_MANAGER, VERIFIER, ADMIN`.

- Middleware: `requireAuth`, `requireRole(...)`, `requireFacilityScope(facilityId)`.
- Gate staff: read-only token verification + entry/exit + override(reason) — never facility mutation.
- Multi-role users allowed; scope checked per route.
- Admin operator verification (Phase 8): `/api/v1/admin/*` requires the `ADMIN` role server-side (`requireAuth` + `requireRole("ADMIN")`) — client role claims are never trusted. The workflow is strict (`PENDING → UNDER_REVIEW → VERIFIED|REJECTED`); any transition from the wrong source state → `409`, unknown ids → `404` (no enumeration). Only `VERIFIED` operators may create/manage facilities, slots, or use operator reservation operations (`403 OPERATOR_NOT_VERIFIED` otherwise); registration and `GET /operators/me` remain open.

## 4. Data & Input

- Server-side validation (zod) on every input; reject oversized payloads.
- ORM/parameterized queries everywhere.
- Headers: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`.
- CORS allowlist (per-env), never `*` with credentials.

## 5. Logging & Audit

- Request IDs, structured logs, no PII-in-excess (minimize: log identifiers only as needed).
- `audit_events` append-only (migration 0008, `DATABASE.md` §2.23); sensitive transitions log an event **inside the same DB transaction** as the mutation — approvals, reviews, rejects, facility activate/deactivate, operator registration, facility/slot CRUD, reservation create/cancel, payment initiate/verify, parking session entry/exit. No application path updates or deletes audit rows and there is no audit-write API (ADMIN-only read).
- Actor identity is the server-side session user (`audit_events.actor_user_id`), surfaced as actor email only through the ADMIN-only audit API; `metadata` is sanitized server-side so credentials/tokens/secrets are never persisted (this covers the parking-session entry token — only its SHA-256 digest is stored, and it never appears in audit metadata). Operator approve additionally records the acting admin (`operators.approved_by` + `approved_at`). The Phase 8 gap that `review` records no reviewer identity and `reject` no reason (`reviewed_by`/`rejection_reason` columns don't exist — `DECISIONS.md` D-036) is now mitigated by the per-transition audit event; the columns remain unadded.
- Parking session access: `parking_sessions` rows are only ever resolved through owner/operator ownership joins (reservation → facility → operator); the session id in the URL is a lookup identifier, never a credential, and any miss returns `404` (no existence disclosure). The one-time `ses_` entry token is bearer-credential material: returned once at entry, stored only as `entry_token_hash` (SHA-256, matching the D-030 refresh-token convention — `DECISIONS.md` D-037).
- **Phase 9, Block 3 — parking-pass token (`ppk_`):** deterministic HS256 JWT (`scope: parking:entry`, `sub` = reservation code, NO `iat` so re-requests are byte-identical, `exp` = `ends_at`) issued by `GET /parking-sessions/by-reservation/{code}/pass` to the reservation owner or the facility's VERIFIED operator only (else `404`). Only the SHA-256 digest is persisted (`reservations.verification_token_hash`, partial UNIQUE — no two reservations share a digest); the raw token never reaches audit metadata, session rows, availability caches, or logs. Reliance on `sub` format (`^BKG-[0-9A-F]{12}$`, a digest-format guard → `INVALID_TOKEN`) keeps malformed/elongated tokens from ever reaching database work. Determinism + in-tx lazy hash backfill means handing out a pass never invalidates a previously-issued one.
- **Gate verification (Block 3):** `POST /parking-sessions/entry` accepts exactly one of `reservationCode`/`verificationToken` (zod `.strict()`, bounds ≤64 / ≤4096) and verifies tokens by digest + reservation window (`TOKEN_NOT_YET_VALID`/`TOKEN_EXPIRED`) — no online JWT secret validation of user-supplied values, no timing side channel beyond the sha256 compare. Rejections persist `GATE_ENTRY_REJECTED`/`GATE_EXIT_REJECTED` with `metadata.reason` = the error code (no token material); successes add `GATE_ENTRY_VERIFIED`/`GATE_EXIT_VERIFIED` + `SLOT_OCCUPIED`/`SLOT_RELEASED`. The slot-occupancy manual guard (`SLOT_IN_USE`) prevents hand-flipping a slot that backs an active session, closing the double-occupancy CLI/operator path.
- **Cancellation lifecycle guard (Block 4.1):** operator cancellation enforces the same state machine as customer cancellation — only `PENDING_PAYMENT`/`CONFIRMED` reservations may be cancelled (`409 CANNOT_CANCEL` otherwise), so a reservation with an ACTIVE parking session can never be cancelled out from under the session (which would otherwise leave an ACTIVE session + OCCUPIED slot behind a CANCELLED row).
- **Operator force-exit (Block 4.2):** `POST /parking-sessions/{id}/cancel` is the sanctioned way to end an active session — role-gated to `PARKING_OPERATOR`, then service-gated to a **VERIFIED** operator of the session's own facility (facility scope derived in SQL via the facility-ownership join; a body `facilityId` is rejected by the strict schema and never trusted). A reservation owner, an unverified operator, an operator of another facility, and any foreign session id all fail closed (`403 FORBIDDEN` / `403 OPERATOR_NOT_VERIFIED` / `404 SESSION_NOT_FOUND` — no existence disclosure). The transition is row-locked (session → reservation → slot) and guarded on `status = 'ACTIVE'`, so it cannot be raced into a double-release or a partial state; the reason (≤500) is the only free text and lands in `cancel_reason` + audit `metadata.reason` (no token material).
- No secrets in logs (redaction on serialize).

## 6. Secret Management

- `.env.example` documents required vars; real `.env` never committed (# in .gitignore).
- CI secret-scan (gitleaks/trufflehog) staged in Phase 1.
- Contract registrar key: dev account on Anvil; file-perms-restricted. Production key mgmt is Level 2/3.

## 7. Secure Development Checklist (each feature)

- [ ] Auth + RBAC enforced.
- [ ] Input validated & data minimized.
- [ ] DB invariants (no double booking) tested.
- [ ] Ownership/IDOR tests pass.
- [ ] Token/QR fraud tests pass (replay, expiry, wrong facility).
- [ ] Credentials at rest are hashed (entry token `ses_`, parking pass `ppk_` → SHA-256 digest + partial unique).
- [ ] Rate limiting present.
- [ ] No secrets in code/tests/commits.
- [ ] Audit log written for sensitive transitions.
- [ ] Contract: access control + reentrancy + replay tested.

## 8. Security Review Commands

`SECURITY REVIEW` session command runs the checklist against current code and reports findings + fixes. (See SESSION_HANDOFF.md for status.)