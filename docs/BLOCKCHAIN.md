# SmartPark India — Blockchain Design (V1)

Status: DRAFT v0.1
Last updated: 2026-08-30
Stack: Solidity ≥0.8, Foundry, EVM-compatible local dev chain (Anvil) in V1.
Mainnet deployment is explicitly OUT of V1.

---

## 1. Guiding Constraints

1. **No personal data on-chain.** No name, phone, email, vehicle number, home address, or any sensitive personal data. On-chain data is verifiable *state/events only*.
2. **Security and simplicity first.** V1 avoids proxy/upgrade machinery. Contracts are versioned (`V1`), immutable after audit within V1 scope.
3. **Local chain only in V1.** Cost = zero; realism studied without real gas/mainnet exposure.
4. **Off-chain is source of truth for PII and business; on-chain is source of truth for token *lifecycle* and *non-repudiation*.**

---

## 2. Contract Set (V1)

### 2.1 ParkingRegistryV1

Purpose: give each parking facility a verifiable, globally-referenceable identity.

```solidity
struct Facility {
  string parkingRef;     // e.g., "PUN-000001" (matches backend parking_id)
  bytes32 operatorRef;   // hashed operator external id (no PII)
  bool active;           // authorized/un-suspended
  string country;        // "IN"
  string stateRef;       // data reference, no PII
  string cityRef;        // data reference
}
```

State/events:
- `registerFacility(parkingRef, operatorRef, cityRef)` — only authorized registrar role.
- `FacilityRegistered/Updated/Suspended/Activated`.
- `setActive(facilityRef, bool)`.

Registrar: backend service key (dev account on Anvil) controls writes; reads are permissionless.

### 2.2 ReservationV1

Purpose: a verifiable on-chain marker that a reservation *reference* exists and has lifecycle.

```solidity
struct Reservation {
  bytes32 reservationRef;   // keccak of reservation_code (no PII)
  bytes32 facilityRef;      // parkingRef hash
  uint256 startsAt;
  uint256 endsAt;
  uint8 state;              // CONFIRMED, ACTIVE, COMPLETED, CANCELLED, EXPIRED
  bool settled;
}
```

Events: `ReservationConfirmed(ref, facility, starts, ends)`, `ReservationCancelled(ref)`, `ReservationCompleted(ref)`, `ReservationExpired(ref)`.

Note: the on-chain record references hashed IDs, never customer data. Double-booking prevention is enforced off-chain in the DB (exclusion constraint); the chain is not the concurrency guard in V1.

### 2.3 ParkingTokenV1

Purpose: a single-use, verifiable digital token of parking rights.

```solidity
struct Token {
  bytes32 tokenRef;       // keccak of token_id
  bytes32 reservationRef; // link
  bytes32 facilityRef;    // link
  uint256 validFrom;      // derived from reservation window
  uint256 validUntil;
  uint8 status;           // ISSUED, IN_USE, COMPLETED, EXPIRED, REVOKED
  bytes32 gatekeeper;     // hashed facility gate identity (no user data)
}
```

Functions (access-controlled):
- `issue(tokenRef, reservationRef, facilityRef, validFrom, validUntil)` — registrar/backend.
- `markInUse(tokenRef)` — gate role for the facility.
- `complete(tokenRef)` — gate role.
- `revoke(tokenRef)` — registrar/admin.

Events: `TokenIssued`, `TokenInUse`, `TokenCompleted`, `TokenExpired`, `TokenRevoked`.
Verification: read `status` + window on-chain; UI/gate also checks the off-chain token JWT for speed, then confirms chain status.

---

## 3. Lifecycle Mapping

| Off-chain (DB) | On-chain (V1) |
|---|---|
| facility approved | ParkingRegistryV1.registerFacility |
| reservation confirmed | ReservationV1.ReservationConfirmed |
| payment success (mock) | prerequisite before confirm |
| token issued | ParkingTokenV1.issue |
| ENTRY approved | ParkingTokenV1.markInUse |
| EXIT approved | ParkingTokenV1.complete + ReservationV1.ReservationCompleted |
| cancellation | ReservationV1.ReservationCancelled (+ token revoked if issued) |
| expiry job | ReservationV1.ReservationExpired + TokenExpired |

---

## 4. Access Control (contract-level)

Implemented with a simple `Ownable`-style pattern plus role map:

```solidity
mapping(bytes32 role => EnumerableSet.AddressSet members)
```

Roles:
- `REGISTRAR` — can register facilities/reservations, revoke tokens.
- `GATE` — scoped to facility gates; markInUse/complete for that facility only.

Principle of least privilege; all role changes are events (`RoleGranted(bytes32,address)`), auditable.

---

## 5. Security Design

Addressed in-contract:

- Reentrancy: no external calls in state-changing token ops; guard functions anyway (Checks-Effects-Interactions).
- Access control: role/per-node checks on every mutating function.
- Token replay: single-use status transitions enforced; a completed/used token cannot be re-entered (state machine + `require`).
- Signature replay: no EIP-712 user-signature flows in V1, so no signature-replay surface; note for future.
- Expired tokens: window validated (`block.timestamp`) at use-time AND a backend/keeper can mark EXPIRED.
- Double issue: uniqueness enforced via mapping existence checks.

---

## 6. Deployment & Testing (V1)

- Local: Foundry `anvil`; deploy script in `contracts/script/`.
- Tests: Foundry (Solidity) covering at minimum (from master prompt §32):
  - double booking attempts rejected (at contract layer where relevant)
  - unauthorized calls revert (wrong role)
  - expired token rejected
  - replay of used token rejected
  - cancellation transitions
  - role/access control matrix
- CI runs `forge test`, `forge build` in the contract test step.

---

## 7. Gas & Cost Notes (see COST_MODEL.md)

- V1 local chain: negligible. Trackgas per op for future reference.
- No dynamic pricing contract logic in V1 (no on-chain price lookups).
- Mainnet L2 EVM is a Level 2/3 decision; revisit with measured usage.

---

## 8. Versioning & Future Upgrades

- Versioned names (`*V1`) per master prompt. No proxy in V1.
- For production later, evaluate (in order): UUPS, timelock, multisig, upgrade authorization, emergency pause — NOT now.
- Any upgrade authority must implement least privilege + audit trail.

---

## 9. Explicitly NOT on-chain (V1)

- PII, vehicle plates, email, phone, addresses.
- Prices at reservation time (business record remains off-chain; on-chain only window refs).
- Availability/occupancy telemetry (raw IoT data).
- Payment amounts/card data.

---

## 10. Risks

- Dev-chain realism ≠ mainnet operational reality (key management, gas, finality, monitoring). Flagged as Level 2/3 work.
- Hashed refs still leak linkage patterns at scale (privacy research later).
- Indexer fails → reads fall back to DB state; on-chain remains an audit/lifecycle layer, not the only check.