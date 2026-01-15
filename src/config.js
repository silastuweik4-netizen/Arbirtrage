// src/config.js
// Base Chain RPC
const ALCHEMY_API_URL = process.env.ALCHEMY_API_URL;

// Token Addresses (ALL LOWERCASE)
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const WETH = '0x4200000000000000000000000000000000000006';

// DEX Router Addresses (ALL LOWERCASE)
const AERODROME_ROUTER = '0xcf77a3ba9a5ca399b7c97c74d6e6b1aba2327f27';
const UNISWAP_V3_ROUTER = '0x2626664c2603336e57b271c5c0b26f421741e481';

// ABIs (Minimal)
// --- FIX IS HERE: Define the struct explicitly ---
const AERODROME_ROUTER_ABI = [
  'struct Pair { address from; address to; bool stable; }',
  'function getAmountsOut(uint256 amountIn, Pair[] path) view returns (uint256[])'
];

const UNISWAP_V3_ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'
];

// Arbitrage Parameters
const TRADE_AMOUNT_USDC = '1000';
const MIN_PROFIT_THRESHOLD_USD = 2.5;

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
