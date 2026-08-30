# SmartPark India — Privacy Policy (DRAFT)

**DRAFT — REQUIRES PROFESSIONAL LEGAL REVIEW**

This is a development-stage draft written by the engineering/product team. It is **not** an approved policy and **not legal advice**. It must be reviewed, revised, and approved by qualified Indian legal counsel before any real commercial launch (see `docs/COMPLIANCE.md` §10).

Status: DRAFT v0.1
Last updated: 2026-08-30
Product: SmartPark India (developed for Pune MVP; architecturally multi-city)

---

## 1. Overview

This draft privacy policy describes how the SmartPark India platform ("we") intends to handle personal data of users and operators. It is aligned with the engineering and privacy-by-design intent in `docs/COMPLIANCE.md` and is written with awareness of the Digital Personal Data Protection Act, 2023 (India) and related rules/guidance.

> [LEGAL REVIEW: confirm legal entity name, registered address, data-fiduciary/substantiality classification, and the precise legal bases to rely upon before publication.]

## 2. Scope

This policy applies to:
- End users ("users") who discover, reserve, pay for, and park using the platform.
- Parking operators, gate staff, verifiers, and admins ("operator users") who register facilities and manage parking operations.

## 3. Data We Collect (Draft Inventory)

Consistent with `docs/COMPLIANCE.md` §2. 

| Data | Examples | Why collected |
|---|---|---|
| Account/contact data | name, email, phone, hashed password, locale | account management, authentication, notices |
| Location data | chosen area / device location | parking discovery |
| Vehicle data | plate number, vehicle type | reservation/session matching |
| Reservation history | facility, slot, times, amounts | service delivery, disputes, history |
| Payment metadata | mock transaction references (no card data) | reconciliation; card data is never stored |
| Operator/business data | operator name, registration number, facility details | onboarding and verification |
| Verification documents | operator identity/business documents, parking images | operator and facility verification |
| Audit data | actor, action, timestamp, IP | security/accountability |
| IoT telemetry | occupancy readings (no personal data) | availability engine |

**[Privacy principle]** We design to collect the minimum data needed for each feature (data minimization, `docs/COMPLIANCE.md` §3).

## 4. How We Use Data

- To operate the platform: discovery, reservation, mock payment, digital token, QR verification, gate entry/exit.
- To communicate: reservation confirmations, status, receipts/notices.
- To verify: operator registrations, facilities, and documents.
- To secure: authentication, audit, fraud and abuse prevention.
- To comply: legal/regulatory obligations, dispute resolution.

We intend **not** to sell personal data. Personal data is shared only with processors needed to run the service (see §8).

> [LEGAL REVIEW: draft mandated DPDP notice fields (identity of data fiduciary, purpose, contact, grievance officer, etc.) and consent text.]

## 5. Consent & Notice

- Registration will include a consent interface and a link to the approved privacy notice.
- Where required, purpose-specific consent toggles (e.g., notifications) apply.
- Consent withdrawal must be honored through account controls; ultimate withdrawal may be deletion.

> [LEGAL REVIEW: DPDP consent requirements (free, specific, informed, unconditional, unambiguous, clear affirmative action) and withdrawal mechanics.]

## 6. Retention

We follow the engineering retention schedule in `docs/COMPLIANCE.md` §4 (e.g., audit logs ~2 years; telemetry raw ~90 days; business/financial records for legal retention windows). These values are design assumptions and require legal confirmation.

> [LEGAL REVIEW: retention windows for financial records and operator verification documents.]

## 7. Security

Data is protected as described in `docs/SECURITY.md`: hashed passwords, short-lived JWTs, RBAC, facility scoping, rate limiting, encrypted transport (TLS/WSS), no card data storage, and on-chain storage limited to non-personal references/hashes.

> [LEGAL REVIEW: what the policy may lawfully promise regarding security measures.]

## 8. Sharing & Processors

We do not intend to sell personal data. Personal data may be processed by service providers (e.g., object storage, future email/SMS/map/payment providers). Processors must be added to the vendor/processor register in `docs/COMPLIANCE.md` §8 and bound by appropriate terms before production.

Personal data is **never** placed on the blockchain; on-chain state is limited to non-personal, hashed references (see `docs/BLOCKCHAIN.md`).

> [LEGAL REVIEW: processor terms, cross-border transfer restrictions, and sub-processor disclosure requirements.]

## 9. User Rights

Consistent with `docs/COMPLIANCE.md` §6, draft rights workflows:
- Access — view own profile and reservation history.
- Correction — update profile data.
- Deletion — request account/data deletion ("delete request" flow).
- Consent withdrawal — notification toggles, account deletion.
- Portability — export of own data (planned).

> [LEGAL REVIEW: mandated timeline to respond to data principal requests and request-process documentation.]

## 10. Children's Data

The platform is intended for individuals eligible to drive/park and is not directed at children. [LEGAL REVIEW: DPDP parental-consent rules for minors before launch.]

## 11. Breach Notification

We maintain a design for incident response and notification (`docs/COMPLIANCE.md` §9). Breach notifications would be made in line with applicable law. [LEGAL REVIEW: notification timelines and content required under DPDP rules.]

## 12. Grievance / Contact

[LEGAL REVIEW: appoint and disclose a designated grievance redressal officer/contact and mechanism as required.]

---

This document is a **DRAFT** for development purposes. Do not publish or present it as an approved policy without professional legal review.