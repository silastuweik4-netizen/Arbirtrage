// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface IAerodromeRouter {
    // Placeholder for Aerodrome Router functions needed for the swap
    // The actual implementation would use the specific swap function
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}
