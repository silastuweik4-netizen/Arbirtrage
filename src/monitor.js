// src/monitor.js
const { ethers } = require('ethers');
const config = require('./config');

class ArbitrageMonitor {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.ALCHEMY_API_URL);
    
    // Use the config strings directly, without getAddress()
    this.aerodromeRouter = new ethers.Contract(config.AERODROME_ROUTER, config.AERODROME_ROUTER_ABI, this.provider);
    this.uniswapRouter = new ethers.Contract(config.UNISWAP_V3_ROUTER, config.UNISWAP_V3_ROUTER_ABI, this.provider);

    this.tradeAmount = ethers.parseUnits(config.TRADE_AMOUNT_USDC, 6); // USDC has 6 decimals
  }

  async getWethPriceOnAerodrome() {
    // How much WETH for our tradeAmount of USDC?
    const amountsOut = await this.aerodromeRouter.getAmountsOut(this.tradeAmount, [[config.USDC, config.WETH, false]]);
    return amountsOut[1];
  }

  async getUsdcPriceOnUniswap(wethAmount) {
    // How much USDC for the WETH we just got? Using 0.3% fee pool.
    const amountsOut = await this.uniswapRouter.exactInputSingle.staticCall({
        tokenIn: config.WETH,
        tokenOut: config.USDC,
        fee: 3000, // 0.3%
        recipient: '0x0000000000000000000000000000000000000001', // Dummy address
        deadline: Math.floor(Date.now() / 1000) + 60,
        amountIn: wethAmount,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
    });
    return amountsOut;
  }

  async checkForOpportunity() {
    try {
      // Step 1: Simulate buying WETH on Aerodrome
      const wethFromAerodrome = await this.getWethPriceOnAerodrome();
      
      // Step 2: Simulate selling that WETH for USDC on Uniswap
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
        console.log(`Checked... No opportunity. Current profit: $${profitNumber.toFixed(4)}`);
      }

    } catch (error) {
      console.error('Error during opportunity check:', error.shortMessage || error.message);
    }
  }
}

module.exports = ArbitrageMonitor;
