#!/usr/bin/env node
/*
 * PancakeSwap V3 live quote – ZORA/USDC 0.3 % pool (Base)
 * Uses factory-proven quoter address
 */
require('dotenv').config();
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider(
  'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
  8453,
  { staticNetwork: true }
);

// --- factory-proven Pancake V3 on Base ----------------------------------------
const QUOTER = ethers.getAddress('0xbC203d7f836C492c7E7dC5B7216c751b485caA63');

// --- ZORA-USDC 0.3 % (the pool you linked) ------------------------------------
const USDC  = ethers.getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
const ZORA  = ethers.getAddress('0x6e17aE0014b66F63fB580D2FE562fe9C38F3EBE0');
const fee   = 3000; // 0.3 %
const amountIn = ethers.parseUnits('1000', 6); // 1000 USDC

// ABI matches Pancake’s tuple return
const QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
];

(async () => {
  const quoter = new ethers.Contract(QUOTER, QUOTER_ABI, provider);
  try {
    const [amountOut] = await quoter.quoteExactInputSingle.staticCallResult(USDC, ZORA, fee, amountIn, 0);
    console.log('✅ Pancake ZORA/USDC 0.3 % quote');
    console.log('1000 USDC →', ethers.formatUnits(amountOut, 18), 'ZORA');
  } catch (e) {
    console.log('❌ Quote failed:', e.shortMessage || e.message);
  }
})();
