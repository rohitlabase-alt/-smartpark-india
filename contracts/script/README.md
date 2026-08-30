# contracts/script

Reserved directory for Foundry deployment/utility scripts (e.g.
`Deploy.s.sol`) used with `forge script` + `--broadcast` against Anvil.

**Status (Phase 1B):** placeholder only. A real deployment script depends on
`forge-std` (`Script`, `vm.broadcast`), which is intentionally not vendored
yet — the contracts phase (docs/ROADMAP.md) adds forge-std along with the
production contract suite and Anvil deployment wiring.

Toolchain verification for Phase 1B is `forge build` and `forge test` against
`contracts/src` and `contracts/test`.
