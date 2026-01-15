// src/config.js

// Base Chain RPC (make sure this is set in Render environment variables)
const ALCHEMY_API_URL = process.env.ALCHEMY_API_URL;

// Token Addresses (Base chain - lowercase is fine)
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const WETH = '0x4200000000000000000000000000000000000006';

// DEX Router Addresses (CORRECTED Aerodrome address)
const AERODROME_ROUTER = '0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43';
const UNISWAP_V3_ROUTER = '0x2626664c2603336e57b271c5c0b26f421741e481';

// Aerodrome Router ABI (full relevant version - your previous one was correct)
const AERODROME_ROUTER_ABI = [
  {
    "inputs": [
      { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
      {
        "components": [
          { "internalType": "address", "name": "from", "type": "address" },
          { "internalType": "address", "name": "to", "type": "address" },
          { "internalType": "bool", "name": "stable", "type": "bool" }
        ],
        "internalType": "struct Router.Route[]",
        "name": "path",
        "type": "tuple[]"
      }
    ],
    "name": "getAmountsOut",
    "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }],
    "stateMutability": "view",
    "type": "function"
  }
  // You can keep the full ABI if you want, but this minimal one is enough and safer
];

// Uniswap V3 SwapRouter ABI (exactInputSingle)
const UNISWAP_V3_ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'
];

// Arbitrage Parameters
const TRADE_AMOUNT_USDC = '1000';              // 1000 USDC
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
