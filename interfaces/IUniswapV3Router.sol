// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface IUniswapV3Router {
    // This interface is only used to define the address, the actual call is made via low-level call.
    // However, for completeness, we can include a function signature that would be called.
    // The actual swap logic will be encoded off-chain.
    function exactInputSingle(
        tuple(
            address tokenIn,
            address tokenOut,
            uint24 fee,
            address recipient,
            uint256 deadline,
            uint256 amountIn,
            uint256 amountOutMinimum,
            uint160 sqrtPriceLimitX96
        ) params
    ) external payable returns (uint256 amountOut);
}
