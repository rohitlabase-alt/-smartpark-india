// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { DevPlaceholder } from "../src/DevPlaceholder.sol";

/// @notice Phase 1B toolchain scaffold test — dependency-free (no forge-std
///         yet). Runs via plain `forge test`; assertions use `require`.
///         forge-std/Test is introduced with the real contract suite.
contract DevPlaceholderTest {
    function test_setProbeValue_then_get() external {
        DevPlaceholder probe = new DevPlaceholder();
        probe.setProbeValue(42);
        require(probe.probeValue() == 42, "probe value mismatch");
    }

    function test_initialProbeValue_isZero() external {
        DevPlaceholder probe = new DevPlaceholder();
        require(probe.probeValue() == 0, "initial value should be 0");
    }

    function test_updateOverwritesPreviousValue() external {
        DevPlaceholder probe = new DevPlaceholder();
        probe.setProbeValue(1);
        probe.setProbeValue(2);
        require(probe.probeValue() == 2, "value should be overwritten");
    }
}