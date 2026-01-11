// abis.js
const QUOTER_V2_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
];

const AERODROME_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, tuple(address from, address to, bool stable, address factory)[] routes) external view returns (uint256[] amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) external returns (uint256[] amounts)"
];

module.exports = {
  QUOTER_V2_ABI,
  AERODROME_ROUTER_ABI
};
