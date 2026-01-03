// Contract ABIs

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)'
];

// Aerodrome uses Route struct: { from, to, stable, factory }
const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, tuple(address from, address to, bool stable, address factory)[] routes) external view returns (uint256[] amounts)',
  'function getReserves(address tokenA, address tokenB, bool stable) external view returns (uint256 reserveA, uint256 reserveB)',
  'function quoteAddLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired) external view returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
  'function quoteRemoveLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity) external view returns (uint256 amountA, uint256 amountB)'
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function balanceOf(address account) external view returns (uint256)'
];

module.exports = {
  QUOTER_V2_ABI,
  AERODROME_ROUTER_ABI,
  ERC20_ABI
};
