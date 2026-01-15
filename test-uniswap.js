#!/usr/bin/env node
/*
 * PancakeSwap V3 quoter test – Base main-net
 * WETH → USDC (0.05 % fee) – pool EXISTS and deep
 */
require('dotenv').config();
const { ethers } = require('ethers');
const config     = require('./config');

(async () => {
  const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL, config.CHAIN_ID, { staticNetwork: true });

  // PancakeSwap V3 deployments on Base -------------------------------------------
  const PANCAKE_QUOTER = ethers.getAddress('0x0eb1b7bdbe6a5ae0cb1f5e2d13b70d1027b5fd5a'); // QuoterV2
  const WETH   = config.tokens.WETH.address;
  const USDC   = config.tokens.USDC.address;
  const amountIn = ethers.parseEther('0.1'); // 0.1 WETH
  const fee    = 500; // 0.05 %

  const QUOTER_ABI = [
    'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)'
  ];

  const quoter = new ethers.Contract(PANCAKE_QUOTER, QUOTER_ABI, provider);

  try {
    const amountOut = await quoter.quoteExactInputSingle.staticCallResult(WETH, USDC, fee, amountIn, 0);
    console.log(`✅ PancakeSwap V3 Base quote`);
    console.log(`0.1 WETH → ${ethers.formatUnits(amountOut, 6)} USDC  (fee 0.05 %)`);
  } catch (e) {
    console.error(`❌ Pancake quoter failed:`, e.shortMessage || e.message);
    process.exit(1);
  }
})();
