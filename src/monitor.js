// src/monitor.js
const { ethers } = require('ethers');
const config = require('./config');

class ArbitrageMonitor {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.ALCHEMY_API_URL);

    this.aerodromeRouter = new ethers.Contract(
      config.AERODROME_ROUTER,
      config.AERODROME_ROUTER_ABI,
      this.provider
    );

    this.uniswapRouter = new ethers.Contract(
      config.UNISWAP_V3_ROUTER,
      config.UNISWAP_V3_ROUTER_ABI,
      this.provider
    );

    this.tradeAmount = ethers.parseUnits(config.TRADE_AMOUNT_USDC, 6); // USDC has 6 decimals
  }

  async getWethPriceOnAerodrome() {
    console.log("  -> Attempting Aerodrome getAmountsOut...");

    // Correct format: array of Route structs (objects)
    const routes = [
      {
        from: config.USDC,
        to: config.WETH,
        stable: false   // volatile pool - most likely for USDC/WETH
        // If you get revert "Pair not found" or similar → try changing to true
      }
    ];

    console.log("  Router address:", this.aerodromeRouter.target);
    console.log("  Route:", JSON.stringify(routes, null, 2));
    console.log("  Amount In:", ethers.formatUnits(this.tradeAmount, 6), "USDC");

    try {
      const amountsOut = await this.aerodromeRouter.getAmountsOut(this.tradeAmount, routes);
      const wethOut = amountsOut[1];

      console.log("  -> Aerodrome call successful.");
      console.log("  WETH received:", ethers.formatEther(wethOut));

      return wethOut;
    } catch (err) {
      console.error("  Aerodrome call failed:", err.shortMessage || err.message);
      throw err;
    }
  }

  async getUsdcPriceOnUniswap(wethAmount) {
    console.log("  -> Attempting Uniswap exactInputSingle...");

    const params = {
      tokenIn: config.WETH,
      tokenOut: config.USDC,
      fee: 3000,                    // 0.3% fee pool - common for WETH/USDC
      recipient: '0x0000000000000000000000000000000000000001', // dummy address
      deadline: Math.floor(Date.now() / 1000) + 3600,
      amountIn: wethAmount,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    };

    console.log("  Params:", JSON.stringify(params, null, 2));

    try {
      const amountOut = await this.uniswapRouter.exactInputSingle.staticCall(params);
      console.log("  -> Uniswap call successful.");
      console.log("  USDC received:", ethers.formatUnits(amountOut, 6));
      return amountOut;
    } catch (err) {
      console.error("  Uniswap call failed:", err.shortMessage || err.message);
      throw err;
    }
  }

  async checkForOpportunity() {
    try {
      console.log(`\n--- Starting New Opportunity Check ---`);

      const wethFromAerodrome = await this.getWethPriceOnAerodrome();
      const usdcFromUniswap = await this.getUsdcPriceOnUniswap(wethFromAerodrome);

      const profit = usdcFromUniswap - this.tradeAmount;
      const profitFormatted = ethers.formatUnits(profit, 6);
      const profitNumber = Number(profitFormatted);

      if (profitNumber > config.MIN_PROFIT_THRESHOLD_USD) {
        console.log(`\n--- OPPORTUNITY FOUND ---`);
        console.log(`Buy ${config.TRADE_AMOUNT_USDC} USDC worth of WETH on Aerodrome.`);
        console.log(`Sell resulting WETH for ${ethers.formatUnits(usdcFromUniswap, 6)} USDC on Uniswap V3.`);
        console.log(`Estimated Profit: $${profitNumber.toFixed(4)}\n`);
      } else {
        console.log(`Result: No opportunity. Current profit: $${profitNumber.toFixed(4)}`);
      }
    } catch (error) {
      console.error('!!! ERROR DURING OPPORTUNITY CHECK !!!');
      console.error('Full error:', error);
      if (error.code === 'BAD_DATA') {
        console.error('BAD_DATA → likely wrong contract address or ABI mismatch');
      }
    }
  }
}

module.exports = ArbitrageMonitor;
