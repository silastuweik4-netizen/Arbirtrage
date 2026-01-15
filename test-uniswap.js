#!/usr/bin/env node
require('dotenv').config();
const { ethers } = require('ethers');

const RPC   = 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0';
const provider = new ethers.JsonRpcProvider(RPC, 8453, { staticNetwork: true });

// --- Base main-net addresses ---
const QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
const WETH      = '0x4200000000000000000000000000000000000006';
const USDC      = '0x833589fCD6EDb6E08f4c7C32D4f71b54bda02913';

const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)'
];

const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, provider);

(async () => {
  const amountIn = ethers.parseEther('0.1'); // 0.1 WETH
  const fee = 3000; // 0.3 %
  try {
    const raw = await quoter.quoteExactInputSingle.staticCallResult([WETH, USDC, fee, amountIn, 0]);
    const amountOut = raw[0];
    console.log('✅ Uniswap V3 Base quote');
    console.log('0.1 WETH →', ethers.formatUnits(amountOut, 6), 'USDC');
  } catch (e) {
    console.error('❌ Quoter failed:', e.shortMessage || e.message);
  }
})();
