# SmartPark India — Terms of Service (DRAFT)

**DRAFT — REQUIRES PROFESSIONAL LEGAL REVIEW**

This is a development-stage draft written by the engineering/product team. It is **not** an approved document and **not legal advice**. It must be reviewed, revised, and approved by qualified Indian legal counsel before any real commercial launch (see `docs/COMPLIANCE.md` §10).

Status: DRAFT v0.1
Last updated: 2026-08-30
Product: SmartPark India (Pune MVP prototype; multi-city architecture)

---

## 1. Purpose of the Terms (Draft)

These draft terms describe the intended relationship between SmartPark India ("the Platform", "we") and:
- Users who use the platform to find, compare, reserve, pay, obtain a token, and park.
- Operators, gate staff, verifiers, and admins who use the platform to list and manage parking facilities.

This draft is written to be consistent with the product scope in `docs/PRD.md`, the payment architecture in `docs/ARCHITECTURE.md` §7, the parking liability/availability model in `docs/PRD.md` §8 and `docs/COMPLIANCE.md` §7, and the operator model in `docs/DATABASE.md`.

> [LEGAL REVIEW: legal entity, governing law and forum, jurisdiction, entire-agreement, severability, and definitions of defined terms.]

## 2. Prototype / MVP Status Acknowledgment

The platform is currently a **prototype** (Level 1) and later an **MVP** (Level 2). It does not claim to be a fully regulated, production-grade commercial service. Users and operators acknowledge that:
- Payments are **mock** in the current version and involve no real money.
- Availability is reported and may be stale or inaccurate; it is not a guarantee.
- Blockchain integration currently runs on a local development chain, not a public mainnet.

> [LEGAL REVIEW: how to phrase the product's regulatory status and any disclaimers at each maturity level.]

## 3. Accounts & Eligibility

- Users must register with accurate details and keep credentials secure.
- The platform is intended for individuals eligible to drive/park. [LEGAL REVIEW: minimum-age/parental-consent rules under DPDP and Indian majority.]
- We may suspend accounts for abuse, fraud, or violation of these terms. (See `docs/PRD.md` §6.4 admin user-management capability.)

## 4. Services (Draft Description)

The platform enables users to: find → compare → reserve → pay (mock) → receive a digital token → verify → park → exit, per the flows in `docs/PRD.md` §9.

## 5. Availability Disclaimer (Important)

- Availability shown on the platform is reported from manual operator updates, existing APIs, or optional IoT sources, and is labeled with its **source, freshness, and confidence** (`docs/PRD.md` §8, `docs/API_SPEC.md` §3).
- **We do not guarantee** that a facility has free space or that reported availability is accurate at any moment.
- Only facilities that are **VERIFIED** in the SmartPark registry can issue reservations and tokens; demo records (`is_demo`) are not official facilities (`docs/PRD.md` §12).

> [LEGAL REVIEW: exact wording of the availability disclaimer and limitation of liability for stale/reported data.]

## 6. Payments (Mock in V1)

- In V1, payments use a **mock provider** — no real financial value is transferred (`docs/ARCHITECTURE.md` §7).
- Payment state is `INITIATED / PENDING / SUCCESS / FAILED / REFUNDED`.
- The platform never stores card details.
- When real payments are added, this section must be redrafted and reviewed for applicable Indian payment regulations and provider terms. [LEGAL REVIEW at that time.]

## 7. Reservations, Cancellation & No-Show (Draft)

- A reservation is confirmed only after a successful (mock) payment and reserves a slot for a defined window.
- Users may cancel before entry; cancellation refunds follow the draft `docs/legal/REFUND_POLICY_DRAFT.md`.
- Expired reservations and no-shows are handled per that refund policy.
- Reserved slots are protected against double booking (`docs/PRD.md` §10).

## 8. Digital Tokens & Acceptable Use (Draft)

- The digital token (QR) evidences a right to park for a specific facility/window.
- Tokens are single-use and expire; sharing, forgery, replay, or misuse of tokens is prohibited and may lead to suspension and, where applicable, legal action.
- Users must present a valid token at the gate; the gate may reject expired, used, or invalid tokens (`docs/PRD.md` §11).

## 9. User Conduct

Users agree not to: submit false data; attempt to bypass security (rate limits, RBAC, verification); probe other users' data (IDOR); interfere with platform operation; or misuse the platform for fraud. (Security expectations in `docs/SECURITY.md`.)

## 10. Operators

Operators are separately bound by the draft `docs/legal/PARKING_OPERATOR_AGREEMENT_DRAFT.md`, including obligations to report availability honestly, verify tokens, manage facilities, and comply with data-handling rules.

## 11. Intellectual Property

The Platform's software, branding, and content are owned by SmartPark India (or its licensors). Users retain their own data subject to these terms and the privacy policy. [LEGAL REVIEW: IP terms.]

## 12. Liability (Draft — No Guarantees Invented)

- The platform is provided "as is" in prototype/MVP stages.
- We do not invent specific liability guarantees here. Liability and responsibility split between SmartPark, operators, data providers, and users is a matter for legal drafting and is earmarked for professional review (see `docs/COMPLIANCE.md` §7).
- This draft does not limit or exclude liability where prohibited by applicable Indian law.

> [LEGAL REVIEW: liability exclusions/limitations, consequential/indirect loss, parking-operator liability, third-party data accuracy.]

## 13. Data Protection

Personal data is handled per the draft privacy policy (`docs/legal/PRIVACY_POLICY_DRAFT.md`) and the design in `docs/COMPLIANCE.md`. Personal data is never stored on-chain (`docs/BLOCKCHAIN.md`).

## 14. Termination

We may suspend or terminate accounts for breach of these terms, abuse, or legal/regulatory reasons, with notice where practicable. Users may delete their account through the deletion workflow.

## 15. Changes to These Terms

Any changes will be communicated and, where required, re-consented. [LEGAL REVIEW: notice periods and material-change clauses.]

## 16. Governing Law & Disputes (Placeholder)

Draft placeholder: laws of India; courts at [city — to be determined]. [LEGAL REVIEW: confirmation of governing law/forum before launch.]

---

This document is a **DRAFT** for development purposes. Do not publish or present it as approved terms without professional legal review.