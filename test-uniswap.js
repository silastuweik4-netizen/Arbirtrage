#!/usr/bin/env node
/*
 * Stand-alone Uniswap V3 quoter test – Base main-net
 * Run: node test-uniswap.js
 */
require('dotenv').config();
const { ethers } = require('ethers');
const config     = require('./config'); // pulls RPC & addresses

(async () => {
  const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL, config.CHAIN_ID, { staticNetwork: true });

  // Pull addresses from config so we have a single source of truth
  const WETH = config.tokens.WETH.address;
  const USDC = config.tokens.USDC.address;
  const QUOTER_V2 = config.contracts.uniswapQuoterV2;

  const QUOTER_ABI = [
    'function quoteExactInputSingle((address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)'
  ];

  const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, provider);

  const amountIn = ethers.parseEther('0.1'); // 0.1 WETH
  const fee = 3000; // 0.3 %

  try {
    const raw = await quoter.quoteExactInputSingle.staticCallResult([WETH, USDC, fee, amountIn, 0]);
    const amountOut = raw[0];
    console.log('✅ Uniswap V3 Base quote');
    console.log('0.1 WETH →', ethers.formatUnits(amountOut, 6), 'USDC');
  } catch (e) {
    console.error('❌ Quoter failed:', e.shortMessage || e.message);
    process.exit(1);
  }
})();
