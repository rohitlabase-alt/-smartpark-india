# SmartPark India — IoT Architecture & Strategy

Status: DRAFT v0.1
Last updated: 2026-08-30
Phase: PHASE 0

**Hard rule: IoT is OPTIONAL.** The platform is fully functional with only manual availability updates. IoT is one input to the Availability Engine, never a hard dependency.

---

## 1. Strategy by Phase

| Phase | Scope | Outcome |
|---|---|---|
| 1 (V1) | IoT **Simulator** in software | Device reg + authenticated telemetry + availability engine integration; no hardware |
| 2 | Optional physical demo (ESP32 + ultrasonic, 4 slots) | Proof the ingestion path works on real sensors |
| 3 | Integrations: existing PMS, ANPR, RFID, sensors, gate controllers, industrial gateways | Adapter-based; no manufacturing |

Never send raw sensor telemetry to blockchain. Never store PII on IoT devices or in telemetry beyond what a slot needs (slot refs only).

---

## 2. IoT Architecture

```
ESP32 + ultrasonic (Phase 2) ──▶ (auth: deviceId + per-device secret)
        │                             │  HTTP or MQTT (MQTT later)
        ▼                             ▼
  IoT Ingestion API ──▶ validate (device known + authenticated)
        │                     │
        ▼                     ▼
  normalize (AVAILABLE/OCCUPIED/ERROR/VOID) ──▶ Availability Engine
                                                  (source=IOT, freshness=≤30s → HIGH)
```

Simulator (Phase 1): a script/CLI (in `iot/`) that emits realistic telemetry for demo facilities: AVAILABLE / OCCUPIED / OFFLINE / STALE.

---

## 3. Device Identity & Security

Every device has:

```
deviceId            unique, human-readable e.g., "DEV-PUN-000001-S1"
operatorId          owning operator
facilityId / slotId optional bindings
authCredentialHash  never plaintext
status              ONLINE / OFFLINE / STALE / ERROR
lastSeenAt          heartbeat tracking
firmwareVersion     for staged rollout / health
```

Rules:
- Unauthenticated/unknown-device telemetry is REJECTED (401/403) and audited.
- STALE: no heartbeat within expected interval → device marked STALE, its readings confidence decays to LOW → availability falls back honestly.
- ERROR: repeated malformed/garbage telemetry → device ERROR, auto-quarantined, operator notified.
- Replay: time-window validation on telemetry (reject messages older than N seconds) to prevent spoofed stale data.

---

## 4. Telemetry Contract

`POST /iot/telemetry` (device-secret auth, NOT user JWT)

```json
{
  "deviceId": "DEV-PUN-000001-S1",
  "slotRef": "SP-PUN-000001-A01",
  "status": "OCCUPIED",
  "sentAt": "2026-08-30T09:00:00Z",
  "seq": 1024
}
```

Backend validates: known device, time-window, monotonic-ish seq (anti-replay), schema. Output → Availability Engine with source=IOT.

---

## 5. Confidence Mapping (IoT path)

| Condition | Confidence |
|---|---|
| update ≤ 30 s, device ONLINE | HIGH |
| update 30 s–10 min | MEDIUM_HIGH → MEDIUM by decay rule |
| > 30 min or device STALE/OFFLINE | LOW |
| no data ever / device ERROR | UNKNOWN |

---

## 6. Phase 2 Hardware Notes (do NOT build in V1)

- ESP32 + HC-SR04 ultrasonic (≈₹500–800 each): duty-cycle sampling, deep sleep, HTTP POST to ingestion endpoint (or MQTT broker later).
- Sample firmware lives in `iot/firmware/` and is optional.
- GUI/local config for WiFi + credentials (never baked secrets for prod).
- 4-slot demo only. No enclosure/industrial build.

---

## 7. Existing-System Integration (Phase 3)

Adapters behind an interface (`AvailabilitySource`) so a PMS/ANPR/RFID/gate API plugs in without engine changes. Evaluate per integration: does the API exist? auth? refresh cadence? SLA? Map to confidence (trusted API ≤ 2 min → MEDIUM_HIGH).

---

## 8. Anti-Spoofing Summary

- Device auth required; unknown devices rejected.
- Time-window + sequence checks against replay.
- Firmware/runtime status surfaced so stale stream can't impersonate fresh.
- Operator owns device registration; admin audits registrations.