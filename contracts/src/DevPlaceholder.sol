// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DevPlaceholder
/// @notice PHASE 1B TOOLCHAIN SCAFFOLDING ONLY.
///         Exists solely to prove the Foundry toolchain compiles and tests
///         cleanly (`forge build` / `forge test`). It is intentionally NOT
///         part of the product surface and will be removed when production
///         contracts begin (ParkingRegistryV1, ReservationV1, ParkingTokenV1,
///         per docs/BLOCKCHAIN.md and docs/ROADMAP.md).
contract DevPlaceholder {
    uint256 public probeValue;

    event ProbeUpdated(uint256 newValue);

    function setProbeValue(uint256 newValue) external {
        probeValue = newValue;
        emit ProbeUpdated(newValue);
    }
}