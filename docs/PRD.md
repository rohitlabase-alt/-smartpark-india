# SmartPark India — Product Requirements Document (PRD)

Status: DRAFT v0.1
Last updated: 2026-08-30
Phase: PHASE 0 (Product + architecture)
Audience: Engineering, Product, future operators/investors

> This document describes the product vision and the Pune MVP (V1) scope.
> It is not a legal document and is not written by legal counsel.

---

## 1. Problem Statement

Parking in Indian cities is fragmented:

- No unified way to discover genuine, verified parking facilities.
- Availability information is unreliable or non-existent.
- Reserved parking is rare; users waste time searching and idling.
- Operators have no low-cost tool to manage slots and reservations.
- No verifiable, non-fakeable proof that a user has a legitimate right to park (digital token).

SmartPark India addresses this with a platform that lets users:

**Find → Compare → Reserve → Pay (mock in V1) → Receive Digital Token → Verify → Park → Exit**

---

## 2. Product Vision

A multi-city, IoT-optional, blockchain-enabled smart parking platform that:

- Works fully without any physical hardware (IoT is optional).
- Aggregates availability from manual, API, and IoT sources through a single Availability Engine.
- Issues verifiable digital parking tokens (blockchain-referenced, QR-deliverable).
- Is built for India from day one (multi-language, cost-aware, compliance-aware).
- Starts in Pune, India, and is designed to expand to Mumbai, Delhi, Bengaluru, Hyderabad, Chennai, Kolkata, Ahmedabad, and more without forking core code.

---

## 3. Business Model (V1 reference)

V1 is a **prototype for validation**, not a revenue business. The intended future model is described for clarity, not implemented now.

| Future revenue stream | Description | V1 status |
|---|---|---|
| Booking fee / commission | Small fee per reservation or % of paid parking | Out of scope |
| Operator SaaS subscription | Dashboard + slot management for operators | Out of scope |
| Verified listing fee | Placement for verified facilities | Out of scope |
| Parking API | B2B availability/reservation API | Out of scope |
| SmartPark IoT Kit | Optional sensor kit for operators | Out of scope |
| Analytics / predictive services | Demand reporting for operators/municipalities | Out of scope |

V1 success is measured by validation metrics (see Section 14), not revenue.

---

## 4. Target Users and Personas

### 4.1 End users (drivers)
- Need to park in Pune (malls, offices, hospitals, on-street/off-street zones).
- Want verified, live availability and a guaranteed token on arrival.
- Value fair pricing, cancellation, and history.

### 4.2 Parking operators
- Own or run a parking facility.
- Want simple reservation + QR check-in/out with zero hardware.
- Manual availability updates are fully acceptable in V1.

### 4.3 Gate staff
- Work at the facility entrance/exit.
- Scan QR and verify/approve entry and exit.

### 4.4 Admins / verifiers
- Onboard and approve operators and facilities.
- Monitor reservations and audit logs.

---

## 5. Roles

Minimum RBAC roles (V1):

| Role | Capability summary |
|---|---|
| USER | Register, login, discover, reserve, pay (mock), token, QR, cancel, history |
| GATE_STAFF | Login, scan QR, verify token, approve entry/exit, manual override with reason |
| PARKING_OPERATOR | Manage own facilities, slots, availability, reservations, QR verify |
| OPERATOR_MANAGER | Manage operator staff/users under an operator org |
| VERIFIER | Review/verify operator and facility registrations |
| ADMIN | Operator approval, facility approval, users, reservations, audit logs |

A user may hold multiple roles (e.g., USER + PARKING_OPERATOR).

---

## 6. V1 Feature Scope (STRICT MVP CUT-LINE)

### 6.1 User
- Registration, login, profile, location.
- Parking discovery (by area, type, availability).
- Parking details (pricing, hours, capacity, facility info).
- Availability display with freshness/confidence labels.
- Reservation (double-booking protected).
- Mock payment.
- Digital parking token (blockchain-referenced) + QR code.
- Parking history.
- Cancellation.

### 6.2 Operator
- Registration (requires admin/verifier approval).
- Parking facility submission (PENDING → UNDER_REVIEW → VERIFIED).
- Parking management (edit, activate/deactivate).
- Slot management.
- Availability update (manual).
- Reservation management (view, confirm, mark occupied/exited).
- QR verification.

### 6.3 Gate staff
- Login.
- QR scanning (camera + manual code entry fallback).
- Token verification.
- Entry approval.
- Exit approval.
- Manual override with a required reason.

### 6.4 Admin
- Operator approval.
- Parking facility approval.
- User management.
- Parking management.
- Reservation monitoring.
- Audit logs.

### 6.5 Blockchain (V1)
- Parking facility identity/reference.
- Reservation reference.
- Digital token (ownership/status/expiry/verification).
- No personal data on-chain.

### 6.6 Maps
- Parking location display.
- Distance calculation.
- Navigation handoff to native maps apps (Google Maps / OSM via provider abstraction).

---

## 7. Explicitly OUT of V1

- Real payment gateway (mock only).
- Mainnet blockchain deployment (local dev chain only).
- Physical IoT hardware as a platform dependency (simulator only in V1).
- ANPR, RFID.
- Dynamic pricing.
- AI prediction.
- EV charging integration.
- Government/PMC API integration.
- Corporate parking.
- Multi-city production deployment.
- Complex microservices (monolith-first backend).
- Native Android/iOS apps (responsive web only).
- Automated gate hardware integration.
- Large-scale Kubernetes infrastructure.

These belong to later roadmap phases. See `ROADMAP.md`.

---

## 8. Availability Semantics (Integrity Rule)

Availability is NEVER presented as a hard guarantee. Every availability value carries:

- `source` — MANUAL | API | IOT
- `lastUpdatedAt` — timestamp
- `confidence` — HIGH | MEDIUM_HIGH | MEDIUM | LOW | UNKNOWN

Rules (initial deterministic model — replace later with measured accuracy):

| Update type | Freshness | Confidence |
|---|---|---|
| IoT update | ≤ 30 s | HIGH |
| Trusted API update | ≤ 2 min | MEDIUM_HIGH |
| Operator (manual) update | ≤ 10 min | MEDIUM |
| Any source | > 30 min | LOW |
| No reliable update | — | UNKNOWN |

UI must display freshness badges (e.g., "Live · just now", "Operator-reported", "Last updated 3 hrs ago", "Unknown").

Only VERIFIED facilities can issue real reservations/tokens.

---

## 9. User Flows

### 9.1 User flow
1. Register/login (email + password, OTP optional later).
2. Set/approve current location (or allow GPS).
3. Search parking (area, type, filters), sort by distance/price/availability.
4. Open facility detail → see availability + freshness + pricing + hours.
5. Reserve a slot/category → choose duration → mock payment.
6. Receive blockchain-referenced digital token + QR.
7. Arrive → show QR to gate staff → verified → enter (session starts).
8. Exit → QR again → session closed, history updated.
9. Cancel anytime before entry (refund logic in mock).

### 9.2 Operator flow
1. Register operator account → submit facilities.
2. Facility reviewed/verified by verifier/admin.
3. Manage slots & availability (manual), view reservations, take offline for maintenance.
4. Verify user QR at entry/exit (or delegate to gate staff).
5. View occupancy reports (basic).

### 9.3 Gate staff flow
1. Login (restricted credential).
2. Scan QR (or enter code).
3. Verify token → approve ENTRY (session begins) → reject/override w/ reason.
4. On exit → scan → approve EXIT (session closes).

### 9.4 Admin flow
1. Login as admin.
2. Approve/reject operators & facilities.
3. Manage users, suspend bad actors.
4. Monitor reservations/sessions; view audit logs.

---

## 10. Reservation Lifecycle

```
AVAILABLE → RESERVED (payment success) → ACTIVE (entry approved)
         → CANCELLED (before entry)
         → COMPLETED (exit approved)
         → EXPIRED (timeout)
         → ABANDONED (no-show handling)
```

Reservation states (backend): `PENDING_PAYMENT`, `CONFIRMED`, `ACTIVE`, `COMPLETED`, `CANCELLED`, `EXPIRED`, `FAILED`.

Consistency rule: a slot cannot be double-booked. Concurrency handled at DB level (row lock / unique constraint), never in application memory alone.

---

## 11. Token Lifecycle

1. Reservation confirmed → token minted/referenced on-chain (local chain in V1).
2. Token carries: reference to reservation, operator, facility, validity window, status.
3. Token shown as QR (and alphanumeric fallback).
4. Gate verifies on-chain status + validity window + not already used.
5. ENTRY → status IN_USE; EXIT → status COMPLETED.
6. Token is single-use; expired/used tokens are rejected.

---

## 12. Pune Demo Data

Demo facilities are clearly labeled, e.g.:

```
DEMO-PUN-001  Koregaon Park Mall
DEMO-PUN-002  Kothrud On-Street Zone
DEMO-PUN-003  Hinjewadi Tech Park
```

Rules:
- Demo data is never represented as official PMC/government data.
- No official partnership is claimed without actual authorization.
- Demo auth email domain may be allowed for testing (documented, disabled in production).

---

## 13. Multi-City Design

- All city/state data is data-driven (tables), never hard-coded.
- Business logic is location-agnostic: city is an input to data/model, not code.
- Demo data stays Pune; production data model supports any city.
- Any Pune-specific logic must be flagged as demo-only in code and docs.

---

## 14. Success Metrics (Pune MVP / Level 2 validation)

| Metric | Target |
|---|---|
| Reservation success (dual-book protection) | 100% no double bookings |
| Token verification false-accept | 0 in test set |
| Availability freshness correctly labeled | 100% consistent with engine |
| Onboarding friction (operator) | < 15 min to first facility |
| Cancellation correctness | Matches mock-payment refund rules |
| User/operator flow completion | Smoke + E2E suites green |

---

## 15. Non-Functional Requirements

- IoT-optional: platform fully functional with manual updates only.
- Real-time: WebSocket primary, HTTP polling fallback.
- Multi-language: English, Marathi, Hindi (i18n for future languages).
- Security: see `SECURITY.md`.
- Compliance: privacy-forward, India DPDP-aware; see `COMPLIANCE.md`.
- Cost: V1 free/local/mock services where practical; see `COST_MODEL.md`.
- Reliability: availability data honesty over fabricated liveness.

---

## 16. Open Questions (tracked in DECISIONS.md)

- On-street vs off-street legal authorization process for real launch.
- Payment provider selection at production.
- On-chain network choice at production.
- Operator SLA / availability guarantee model.
- Whether mock QR verification is sufficient for Level 2 pilot.

---

## 17. Out of Session 1 Scope (Build)

Session 1 produces documentation only. No application code is implemented until PHASE 1.