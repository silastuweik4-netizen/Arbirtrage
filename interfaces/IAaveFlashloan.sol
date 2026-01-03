// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface IAaveFlashloan {
    function flashLoanSimple(
        address receiver,
        address asset,
        uint256 amount,
        uint256 premium,
        bytes calldata params
    ) external returns (bool);
}
