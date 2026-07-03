// SPDX-License-Identifier: MIT

pragma solidity 0.8.29;

import { SchemaResolver } from "../SchemaResolver.sol";

import { IEAS, Attestation } from "../../IEAS.sol";

/// @title SelfVerifyingResolver
/// @notice A sample schema resolver for claims that are decidable from public on-chain state. The
///     attestation data encodes a read `(target, callData)` together with the outcome the attester
///     claims (`expected`). At attestation time the resolver performs the read and accepts the
///     attestation only if the recomputed result equals the claim. Anyone can later re-run the same
///     read and reach the same verdict, so the attestation carries assurance from reproducibility
///     rather than from trusting the attester.
///
///     Scope, by design: this decides only outcomes that are decidable from public on-chain data by a
///     fixed read. A false claim is rejected, and a read that reverts (an outcome not decidable this
///     way) is also rejected rather than guessed.
contract SelfVerifyingResolver is SchemaResolver {
    constructor(IEAS eas) SchemaResolver(eas) {}

    /// @dev Expects `attestation.data` to be `abi.encode(address target, bytes callData, bytes32 expected)`.
    function onAttest(Attestation calldata attestation, uint256 /*value*/) internal view override returns (bool) {
        (address target, bytes memory callData, bytes32 expected) = abi.decode(
            attestation.data,
            (address, bytes, bytes32)
        );

        (bool success, bytes memory result) = target.staticcall(callData);

        // Accept only when the read succeeds and the recomputed result matches the claimed outcome.
        return success && keccak256(result) == expected;
    }

    function onRevoke(Attestation calldata /*attestation*/, uint256 /*value*/) internal pure override returns (bool) {
        return true;
    }
}
