#!/usr/bin/env node
require('dotenv').config();
const { ethers } = require('ethers');
const config     = require('./config');

(async () => {
  const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL, config.CHAIN_ID, { staticNetwork: true });

  const WETH = config.tokens.WETH.address;
  const USDC = config.tokens.USDC.address;
  const QUOTER_V2 = config.contracts.uniswapQuoterV2;

  const QUOTER_ABI = [
    'function quoteExactInputSingle((address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)'
  ];

  const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, provider);

  const amountIn = ethers.parseEther('0.1');
  const tiers = [500, 3000, 10000]; // 0.05 %, 0.3 %, 1 %

  for (const fee of tiers) {
    try {
      const raw = await quoter.quoteExactInputSingle.staticCallResult([WETH, USDC, fee, amountIn, 0]);
      console.log(`✅ Fee ${fee} (0.${fee/100} %)  0.1 WETH → ${ethers.formatUnits(raw[0], 6)} USDC`);
    } catch (e) {
      console.log(`❌ Fee ${fee} (0.${fee/100} %)  pool missing or reverting`);
    }
  }
})();
