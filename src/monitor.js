// src/monitor.js
const { ethers } = require('ethers');
const config = require('./config');

class ArbitrageMonitor {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.ALCHEMY_API_URL);
    
    // Use the config strings directly, without getAddress()
    this.aerodromeRouter = new ethers.Contract(config.AERODROME_ROUTER, config.AERODROME_ROUTER_ABI, this.provider);
    this.uniswapRouter = new ethers.Contract(config.UNISWAP_V3_ROUTER, config.UNISWAP_V3_ROUTER_ABI, this.provider);

    this.tradeAmount = ethers.parseUnits(config.TRADE_AMOUNT_USDC, 6);
  }

  async getWethPriceOnAerodrome() {
    console.log("  -> Attempting Aerodrome getAmountsOut...");
    const amountsOut = await this.aerodromeRouter.getAmountsOut(this.tradeAmount, [[config.USDC, config.WETH, false]]);
    console.log("  -> Aerodrome call successful.");
    return amountsOut[1];
  }

  async getUsdcPriceOnUniswap(wethAmount) {
    console.log("  -> Attempting Uniswap exactInputSingle.staticCall...");
    const params = {
        tokenIn: config.WETH,
        tokenOut: config.USDC,
        fee: 3000,
        recipient: '0x0000000000000000000000000000000000000001',
        deadline: Math.floor(Date.now() / 1000) + 60,
        amountIn: wethAmount,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
    };
    const amountsOut = await this.uniswapRouter.exactInputSingle.staticCall(params);
    console.log("  -> Uniswap call successful.");
    return amountsOut;
  }

  async checkForOpportunity() {
    try {
      console.log(`\n--- Starting New Opportunity Check ---`);
      
      // Step 1
      const wethFromAerodrome = await this.getWethPriceOnAerodrome();
      
      // Step 2
      const usdcFromUniswap = await this.getUsdcPriceOnUniswap(wethFromAerodrome);

      // Step 3: Calculate Profit
      const profit = usdcFromUniswap - this.tradeAmount;
      const profitFormatted = ethers.formatUnits(profit, 6);
      const profitNumber = Number(profitFormatted);

      if (profitNumber > config.MIN_PROFIT_THRESHOLD_USD) {
        console.log(`\n--- OPPORTUNITY FOUND ---`);
        console.log(`Buy ${config.TRADE_AMOUNT_USDC} USDC worth of WETH on Aerodrome.`);
        console.log(`Sell resulting WETH for ${ethers.formatUnits(usdcFromUniswap, 6)} USDC on Uniswap.`);
        console.log(`Estimated Profit: $${profitNumber.toFixed(4)}\n`);
      } else {
        console.log(`Result: No opportunity. Current profit: $${profitNumber.toFixed(4)}`);
      }

    } catch (error) {
      // --- THIS IS THE IMPORTANT CHANGE ---
      console.error('\n!!! ERROR DURING OPPORTUNITY CHECK !!!');
      console.error('Full Error Object:', JSON.stringify(error, null, 2)); // Log the full error
      console.error('Error Stack:', error.stack);
    }
  }
}

module.exports = ArbitrageMonitor;
