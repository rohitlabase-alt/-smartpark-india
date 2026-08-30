# SmartPark India — Cost Model (V1; update per phase)

Status: DRAFT v0.1
Last updated: 2026-08-30
Phase: PHASE 0

Principle (from master prompt §23): use local/free/open-source/mock services wherever practical. Any paid infrastructure must be justified (why, expected cost, free alternative, scaling implication).

---

## 1. V1 Cost Baseline (prototype — target ₹0/month recurring)

| Category | V1 option | Recurring cost | Scaling implication |
|---|---|---|---|
| Database | Postgres in Docker (local) | ₹0 | Add managed PG for staging later |
| Hosting/deploy | Local + GitHub Actions runners | ₹0 | Paid runners/hosts at Level 3 |
| Blockchain | Foundry Anvil (local dev chain) | ₹0 (gas negligible) | L2 EVM + indexer at Level 3 |
| Maps/geocoding/routing | OSM-based free provider; navigation deep links | ₹0 | Free tier limits → evaluate paid maps at scale |
| SMS | Mock provider (no real SMS in V1) | ₹0 | Paid SMS API (transactional) later |
| Email | Local dev mail / console mock | ₹0 | Free tiers (e.g., SMTP/transactional) later |
| Push | In-app notifications only (no FCM in V1) | ₹0 | Firebase/APNs at mobile phase |
| Storage | Local disk / Postgres | ₹0 | Object storage (S3-compatible) at Level 3 |
| Monitoring | Console + structured logs (self-hosted opt-in) | ₹0 | Sentry/OTel at production |
| IoT hardware | Simulator only in V1 (software) | ₹0 | ESP32 (~₹500–800/unit) + connectivity at Phase 9 |
| IoT connectivity | Not applicable (simulator) | ₹0 | SIM/eSIM/MQTT broker fees later |
| Payment fees | Mock provider — no real money | ₹0 | UPI (≈0 + provider fees) at real-payment phase |

### One-off / small
- ESP32 boards + ultrasonic sensors for the optional 4-slot demo: ~₹4,000–8,000 (Phase 9, budget optional).
- Domain/hosting only if a team chooses to publish a prototype preview.

---

## 2. Cost Tracking Table (operational; append per phase)

| Item | Phase | Provider (planned) | Est. cost | Free alternative | Notes |
|---|---|---|---|---|---|
| (append rows as choices are made) | | | | | |

---

## 3. Decision Rules

- A new paid service requires a note in DECISIONS.md + this file with: why required / expected cost / free alternative / scaling implication.
- V1 teams must NOT pay for anything that has a working free/local/mock equivalent.
- Gas: track per-tx gas in contract tests to feed the L2 (Level 3) cost estimate.

---

## 4. Cost Assumptions (recorded)

1. Demo image assets: free (SVG/icons, open-layouts) in V1.
2. Fonts/assets local; no CDN spend.
3. CI minutes fit within free GitHub Actions quotas at V1 scale.
4. No production monitoring spend until staging/production need justifies it.
5. Currency display INR; cost model in INR.

---

## 5. Business-Scale Projections (informational only)

These are NOT commitments, just orders-of-magnitude to inform roadmap:
- Managed Postgres: ~$15–30/mo small instance → scales with read replicas.
- L2 EVM (e.g., Polygon/Base-class): pennies per tx class; thousands of tokens/tx are cheap.
- SMS at ~₹0.2–0.5/txn msg becomes a real cost at scale → batch + remove noise early.
- Maps paid tier triggers at high MAU; negotiate OSM/maintain own tiles if needed.

Revisit in COST_MODEL at each Level transition.