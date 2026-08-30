# SmartPark India — Compliance & Privacy Model (India)

Status: DRAFT v0.1
Last updated: 2026-08-30
Phase: PHASE 0
Governance note: This document reflects design intent for privacy-forward operation in India, including awareness of the Digital Personal Data Protection Act, 2023 (DPDP Act) and related rules/guidance. It is **not legal advice**. Engage qualified Indian legal/compliance counsel before any real commercial launch.

---

## 1. Applicable Framework (design-relevant)

- DPDP Act 2023 (consent-based, notice, rights, purpose limitation, data minimization, security safeguards, breach notification, significant data fiduciary obligations).
- Relevant payment/regulatory obligations at payment-launch time (review before real payments).
- Parking/road/taxing rules governed by local authorities (PMC etc.) — authorization is a separate track outside this doc.

---

## 2. Data Inventory (what we collect, why, where)

| Data element | Purpose (lawful basis) | Stored | On-chain? |
|---|---|---|---|
| Email, phone, hashed password | account/auth, notices | Postgres | NO |
| Name | profile, tickets | Postgres | NO |
| Location/area | discovery | Postgres (transient) | NO |
| Vehicle plate | reservation/session matching | Postgres | NO (hashed ref only if used on-chain) |
| Reservation history | service delivery, dispute | Postgres | NO (hashed references) |
| Payment meta (mock txn refs) | reconciliation | Postgres | NO (and no card data ever stored) |
| IoT telemetry (occupancy) | availability engine | Postgres | NO |
| Verification documents + parking images (operator identity/business docs) | onboarding, operator & facility verification | Object storage (private) + Postgres metadata | NO |
| Audit logs (actor/entity snapshots) | security/accountability | Postgres | NO |
| On-chain token lifecycle | verification/non-repudiation | EVM local chain | REFERENCE DATA ONLY (no PII) |

---

## 3. Principles Applied

1. **Data minimization** — collect only what a feature needs; no speculative collection.
2. **Purpose limitation** — each field mapped to an explicit purpose (table above).
3. **Consent/notice** — registration consent flow; privacy notice page; per-purpose consent toggles where meaningful (notifications). In-app notice link at minimum for V1; production needs DPDP-drafted notice/consent by counsel.
4. **Retention + deletion** — retention schedule (below), deletion workflow (below).
5. **User rights** — access, correction, deletion, withdrawal-of-consent workflows (below).
6. **Access control** — RBAC + facility scoping; admin-only for PII bulk export.
7. **Audit logs** — append-only, timestamped, actor-attributed.
8. **Incident response** — communication plan + DPDP breach notification tracker (design now, operable rules confirmed with counsel).
9. **Processors/vendors** — only free/mock providers in V1; each future paid provider evaluated as data processor with contract terms; keep a vendor registry.
10. **Security safeguards** — see SECURITY.md.

---

## 4. Retention Schedule (initial, to be confirmed with counsel)

| Data | Retention |
|---|---|
| Account (active) | while active + deactivation grace |
| Reservations/payments | business record: e.g., 1–3 years for reconciliation/legal (confirm) |
| Sessions | derived from reservations |
| Audit logs | 2 years (confirm; apolitical append-only archive) |
| Verification documents | while operator/facility active + legal retention window after termination (confirm with counsel); images/facility-attachments per facility lifecycle |
| IoT telemetry | 90 days raw; availability state kept |
| Failed registrations | 30–60 days then purge legal bases |
| Tokens/QR JWTs | until completion + small buffer |

## 5. Deletion Workflow (user-initiated "Right to be forgotten")

1. `POST /users/me/delete-request` → holds account, blocks login, queues purge in 7 days (cooling-off; can cancel).
2. Purge: anonymize or delete PII rows; reservations/sessions/payments retained in aggregated/anonymized form to satisfy business/legal retention of financial records (where permitted).
3. Personal data scrubbed from audit snapshots or keyed away from direct PII; on-chain references are non-PII hashed refs — deletion off-chain is decoupled from chain (chain keeps non-PII lifecycle only).
4. Log completion event for transparency.

---

## 6. User Rights Workflow (V1 minimal)

| Right | Mechanism |
|---|---|
| Access | `GET /users/me` + export own reservations (`/users/me/export`) |
| Correction | `PATCH /users/me` |
| Deletion | `POST /users/me/delete-request` (Section 5) |
| Consent withdraw | profile toggles (notifications); deletion path as ultimate withdrawal |
| Portability | export JSON (considered V1.1) |

Production: full DPDP request intake + ticketing, validated/de-identified disclosures, timelines tracked.

---

## 7. Management of Availability Claims

- The platform distinguishes LIVE / operator-reported / estimated / unknown at all times (see ARCHITECTURE.md §4–5, API_SPEC.md §3).
- No guarantee of availability unless the business actually supports it (V1 does not).
- Before production: document responsibility split SmartPark / Operator / Data Provider / User (contractual + UI disclaimers) — do not invent liability rules; counsel drafts.

---

## 8. Vendor / Processor Register (V1=free/mock)

| Vendor | Role | Data shared | Status |
|---|---|---|---|
| (self) Postgres | storage | all per inventory | local |
| MinIO (local object storage, S3-compatible) | operator verification documents & parking images (private) | uploaded documents/images | local; prod switches to S3-compatible provider behind abstraction (`ARCHITECTURE.md` §12) |
| Mock email/SMS adapter | notices | email/phone | no-op/mock in V1 |
| Map (OSM or free provider) | display | coordinates only | TBD at Phase 3 choice |
| Anvil (local chain) | token lifecycle | hashed refs only | local |
| Future providers | — | — | must be added to this register before production |

---

## 9. Incident Response (design)

1. Detect (anomaly/alert hooks) → 2. Contain → 3. Assess scope → 4. Notify (regulators per DPDP, affected users, operators) → 5. Remediate → 6. Postmortem (docs/incidents/). Contact/communication plan owned by product owner; OKR to keep a runbook on file.

---

## 10. Confirmation Gate

Before any real commercial launch (Level 2/3) the following MUST be reviewed by qualified Indian counsel:
- Privacy notice + consent flows per DPDP.
- Retention windows and deletion procedure legality.
- Breach notification process/timelines.
- Operator/User terms + liability split for availability claims.
- Payment / UPI provider obligations at that time.

None of the above is legal advice; this document is engineering design intent.