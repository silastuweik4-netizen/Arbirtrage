#!/usr/bin/env node
/*
 * Uniswap V3 quoter test – Base main-net
 * Tests USDC → USDbC (0.01 % fee) – pool EXISTS
 */
require('dotenv').config();
const { ethers } = require('ethers');
const config     = require('./config');

(async () => {
  const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL, config.CHAIN_ID, { staticNetwork: true });

  // Use a pool we KNOW exists on Base -------------------------------------------------
  const tokenIn  = config.tokens.USDC.address;
  const tokenOut = config.tokens.USDbC.address;
  const fee      = 100; // 0.01 % tier
  const amountIn = ethers.parseUnits('1000', 6); // 1000 USDC

  const QUOTER_ABI = [
    'function quoteExactInputSingle((address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)'
  ];

  const quoter = new ethers.Contract(config.contracts.uniswapQuoterV2, QUOTER_ABI, provider);

  try {
    const raw = await quoter.quoteExactInputSingle.staticCallResult([tokenIn, tokenOut, fee, amountIn, 0]);
    const amountOut = raw[0];
    console.log(`✅ Uniswap V3 Base quote`);
    console.log(`1000 USDC → ${ethers.formatUnits(amountOut, 6)} USDbC  (fee 0.01 %)`);
  } catch (e) {
    console.error(`❌ Quoter failed:`, e.shortMessage || e.message);
    process.exit(1);
  }
})();
