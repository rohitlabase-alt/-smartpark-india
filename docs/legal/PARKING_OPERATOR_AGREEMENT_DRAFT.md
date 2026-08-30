# SmartPark India — Parking Operator Agreement (DRAFT)

**DRAFT — REQUIRES PROFESSIONAL LEGAL REVIEW**

This is a development-stage draft written by the engineering/product team. It is **not** an approved agreement and **not legal advice**. It must be reviewed, revised, and approved by qualified Indian legal counsel and, where applicable, adapted to each operator's jurisdiction and contract template before any real commercial launch.

Status: DRAFT v0.1
Last updated: 2026-08-30
Product: SmartPark India (Pune MVP prototype; multi-city architecture)

---

## 1. Parties (Draft)

SmartPark India ("the Platform") and the parking facility operator ("Operator"). This draft covers the intended responsibilities and obligations of Operators using the platform to list and manage parking facilities, slots, availability, reservations, and gate verification.

## 2. Operator Registration & Verification

- Operators register on the platform (`docs/PRD.md` §5, `docs/DATABASE.md` §2.4 `operators`).
- Operator and facility records pass through verification states: `PENDING → UNDER_REVIEW → VERIFIED / REJECTED` (and `SUSPENDED / ACTIVE / INACTIVE` for operational state).
- Operators must submit accurate business details and, where required, verification documents (see `docs/DATABASE.md` §2.23 `documents`).
- **Only VERIFIED facilities can issue real reservations/tokens** (consistent with `docs/PRD.md` §8: "Only VERIFIED facilities can issue real reservations/tokens").

> [LEGAL REVIEW: obligation to hold all required licenses/authorizations to operate the facility and to indemnify the platform against misrepresentation.]

## 3. Facility Listings (Draft)

- Operators agree to keep facility data (name, address, coordinates, capacity, pricing, operating hours, status) accurate and current.
- Demo records (`is_demo`, `DEMO-PUN-*`) are not represented as official/government facilities (`docs/PRD.md` §12).

## 4. Availability Reporting Obligation (Important)

- Operators report availability truthfully via the platform (manual updates, or connected APIs/IoT sources). Availability carries **source, freshness, and confidence** and is never presented as a guarantee by the platform (`docs/PRD.md` §8).
- Operators must update availability when their facility's actual occupancy changes, and must not deliberately misreport.
- Operator-reported availability **is not a guarantee** that space physically exists at arrival; the platform disclaims this as described in the Terms (`docs/legal/TERMS_OF_SERVICE_DRAFT.md` §5).

> [LEGAL REVIEW: what accuracy standard (e.g., best-efforts vs. contractual) is appropriate for operator availability reporting, and remedy for misreporting.]

## 5. Tokens & Gate Verification (Draft)

- The Operator (or its gate staff) must verify the digital token/QR before permitting entry and on exit (`docs/PRD.md` §6.3, §11).
- Entry/exit approvals and manual overrides (with required reason) are recorded and audited.
- Gate staff are restricted to verification/entry/exit/override and cannot mutate facilities (`docs/SECURITY.md` §3, decision D-013).

## 6. Offline Gate Mode (Draft)

- Where specified by the platform, gate devices/applications may support a bounded offline mode with a local cache, an event queue, and synchronization when connectivity returns (`docs/ARCHITECTURE.md` §11 — Offline Gate Mode).
- Offline acceptance is **limited and time-boxed**; the Operator is responsible for using offline features only as configured and for ensuring no unauthorized entry is accepted.
- [LEGAL REVIEW: operator liability for decisions taken during offline windows.]

## 7. Payments & Fees (Draft)

- V1 uses **mock payments**; no real money flows (`docs/ARCHITECTURE.md` §7).
- Future fee structures (commission/booking fee/subscription) are out of scope now (`docs/PRD.md` §3) and would be agreed in separate terms.
- When real payments launch, Operators and the Platform must redraft this section and comply with applicable payment regulations.

## 8. Data Handling (Draft)

- Operators may lawfully access only the data necessary for their role (own facilities, own reservations, token verification).
- User personal data must not be exported, sold, or used beyond platform purposes (see `docs/legal/PRIVACY_POLICY_DRAFT.md`, `docs/COMPLIANCE.md`).
- Personal data is never stored on-chain (`docs/BLOCKCHAIN.md`).

## 9. Liability & Responsibility Split (Draft — No Guarantees Invented)

This draft does **not** invent a specific liability allocation. The split of responsibility between SmartPark, Operator, data providers, and users must be drafted by counsel (see `docs/COMPLIANCE.md` §7).

> [LEGAL REVIEW: (a) venue/custody/security of parked vehicles at the facility — Operator's responsibility; (b) platform vs. Operator responsibility for availability data, reservation failures, and token verification errors; (c) indemnities; (d) limitation of liability.]

## 10. Term, Suspension & Termination (Draft)

- Either party may terminate per agreed notice. [LEGAL REVIEW: notice periods.]
- The platform may suspend facilities that are `SUSPENDED`/`REJECTED` or that breach these terms (verification/status flow in `docs/DATABASE.md` §2.4, §2.6).
- On termination, listing and reservation capability ceases; historical records are retained per retention rules (`docs/COMPLIANCE.md` §4).

## 11. Audit & Records (Draft)

- Operators expect the platform to retain audit logs of approvals, availability changes, overrides, and verification events (append-only, `docs/DATABASE.md` §2.22).
- [LEGAL REVIEW: audit/records cooperation and inspection clauses.]

## 12. Anti-Bribery / Compliance / IL (Draft placeholder)

- Operators must not make payments/gifts to government officials in connection with facilitating this agreement without lawful basis. [LEGAL REVIEW: representation/warranty wording.]

## 13. Miscellaneous (Draft placeholder)

- Governing law/forum, notices, amendment, assignment — to be finalized by counsel.

---

This document is a **DRAFT** for development purposes. It deliberately avoids inventing monetary terms, guarantees, or liability allocations. Do not present it as an approved agreement without professional legal review.