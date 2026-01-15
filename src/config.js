// src/config.js
// Base Chain RPC
const ALCHEMY_API_URL = process.env.ALCHEMY_API_URL;

// Token Addresses (Checksummed)
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';

// DEX Router Addresses
const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d6e6b1aba2327f27';
const UNISWAP_V3_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';

// ABIs (Minimal)
const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, tuple(address from, address to, bool stable)[] path) view returns (uint256[])'
];

const UNISWAP_V3_ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'
];

// Arbitrage Parameters
const TRADE_AMOUNT_USDC = '1000'; // Amount of USDC to start the trade with
const MIN_PROFIT_THRESHOLD_USD = 2.5; // Minimum profit in USD to consider an opportunity

module.exports = {
  ALCHEMY_API_URL,
  USDC,
  WETH,
  AERODROME_ROUTER,
  UNISWAP_V3_ROUTER,
  AERODROME_ROUTER_ABI,
  UNISWAP_V3_ROUTER_ABI,
  TRADE_AMOUNT_USDC,
  MIN_PROFIT_THRESHOLD_USD,
};
