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
    console.log("  -> Attempting Aerodrome getAmountsOut...");
    try {
      // This is the original call that is failing
      const amountsOut = await this.aerodromeRouter.getAmountsOut(this.tradeAmount, [[config.USDC, config.WETH, false]]);
      console.log("  -> Aerodrome call successful.");
      return amountsOut[1];
    } catch (error) {
      // If the call fails, we make a low-level call to get the revert reason
      console.error("  -> High-level call failed. Attempting low-level call to get revert reason...");
      try {
        const tx = {
          to: config.AERODROME_ROUTER,
          data: this.aerodromeRouter.interface.encodeFunctionData("getAmountsOut", [this.tradeAmount, [[config.USDC, config.WETH, false]]])
        };
        await this.provider.call(tx);
      } catch (lowLevelError) {
        // The revert reason is usually in lowLevelError.data
        console.error("  !!! LOW-LEVEL CALL REVERTED !!!");
        console.error("  Revert Data:", lowLevelError.data);
        
        // Try to decode the revert reason if it's a standard string
        if (lowLevelError.data && lowLevelError.data.startsWith('0x08c379a0')) {
          const reason = ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + lowLevelError.data.slice(10))[0];
          console.error("  Decoded Revert Reason:", reason);
        }
      }
      // Re-throw the original error to stop the check
      throw error;
    }
  }

  async getUsdcPriceOnUniswap(wethAmount) {
    console.log("  -> Attempting Uniswap exactInputSingle.staticCall...");
    const params = {
        tokenIn: config.WETH,
        tokenOut: config.USDC,
        fee: 3000, // 0.3%
        recipient: '0x0000000000000000000000000000000000000001', // Dummy address
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
      // The detailed error is now logged inside getWethPriceOnAerodrome
      // We just log a simple message here to avoid clutter.
      console.error('!!! ERROR DURING OPPORTUNITY CHECK !!! See details above.');
    }
  }
}

module.exports = ArbitrageMonitor;
