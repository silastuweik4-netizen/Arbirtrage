const { ethers } = require('ethers');
const chalk = require('chalk');
const config = require('./config');
const { QUOTER_V2_ABI, AERODROME_ROUTER_ABI } = require('./abis');

class ArbitrageBot {
  constructor() {
    // Root Cause Fix: Use staticNetwork to prevent the "failed to detect network" loop in ethers v6
    const rpcUrl = config.PRIVATE_RPC_URL || config.BASE_RPC_URL;
    const chainId = config.CHAIN_ID || 8453;

    console.log(chalk.blue(`📡 Initializing DRY RUN Mode for Chain ID ${chainId}...`));
    
    try {
      this.provider = new ethers.JsonRpcProvider(rpcUrl, chainId, {
        staticNetwork: true
      });
    } catch (error) {
      console.error(chalk.red('❌ Failed to initialize JsonRpcProvider:'), error.message);
      process.exit(1);
    }

    // In Dry Run, we don't need real contract instances for execution, 
    // but we still need the Quoter and Router to fetch prices.
    const uniswapQuoterAddr = config.contracts.uniswapQuoterV2 || '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
    const aerodromeRouterAddr = config.contracts.aerodromeRouter || '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43';

    this.uniswapQuoter = new ethers.Contract(uniswapQuoterAddr, QUOTER_V2_ABI, this.provider);
    this.aerodromeRouter = new ethers.Contract(aerodromeRouterAddr, AERODROME_ROUTER_ABI, this.provider);
    
    this.isRunning = false;
    this.opportunitiesFound = 0;
    this.simulatedProfit = 0;
  }

  formatAmount(amount, decimals) { return ethers.formatUnits(amount, decimals); }
  parseAmount(amount, decimals) { return ethers.parseUnits(amount.toString(), decimals); }

  async getUniswapQuote(tokenIn, tokenOut, amountIn, fee) {
    try {
      const params = {
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountIn: this.parseAmount(amountIn, tokenIn.decimals),
        fee: fee,
        sqrtPriceLimitX96: 0
      };
      const result = await this.uniswapQuoter.quoteExactInputSingle.staticCall(params);
      return { amountOut: parseFloat(this.formatAmount(result[0], tokenOut.decimals)), success: true };
    } catch (e) { return { success: false }; }
  }

  async getAerodromeQuote(tokenIn, tokenOut, amountIn) {
    try {
      const routes = [{ from: tokenIn.address, to: tokenOut.address, stable: false, factory: config.contracts.aerodromeFactory }];
      const amounts = await this.aerodromeRouter.getAmountsOut(this.parseAmount(amountIn, tokenIn.decimals), routes);
      return { amountOut: parseFloat(this.formatAmount(amounts[1], tokenOut.decimals)), success: true };
    } catch (e) { return { success: false }; }
  }

  async calculateNetProfit(tokenIn, tokenOut, amountIn, fee) {
    const [uni, aero] = await Promise.all([
      this.getUniswapQuote(tokenIn, tokenOut, amountIn, fee),
      this.getAerodromeQuote(tokenIn, tokenOut, amountIn)
    ]);

    if (!uni.success || !aero.success) return -1;

    const buyPrice = Math.min(uni.amountOut / amountIn, aero.amountOut / amountIn);
    const sellPrice = Math.max(uni.amountOut / amountIn, aero.amountOut / amountIn);
    
    const grossProfit = (sellPrice - buyPrice) * amountIn;
    const flashloanFee = amountIn * buyPrice * 0.0005; // Aave V3 fee is 0.05%
    const gasFee = 0.20; // Estimated gas fee on Base

    return grossProfit - flashloanFee - gasFee;
  }

  async findOptimalSize(pair) {
    const token0 = config.tokens[pair.token0];
    const token1 = config.tokens[pair.token1];
    const maxSize = config.settings.depthAmount || 10;
    
    let bestSize = 0;
    let maxNetProfit = 0;
    
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const testSize = (maxSize / steps) * i;
      const netProfit = await this.calculateNetProfit(token0, token1, testSize, pair.fee);
      
      if (netProfit > maxNetProfit) {
        maxNetProfit = netProfit;
        bestSize = testSize;
      }
    }
    
    return { bestSize, maxNetProfit };
  }

  async executeArbitrage(pair, optimalSize, netProfit) {
    // DRY RUN VERSION: No real transaction sent
    console.log(chalk.magenta.bold(`\n🧪 [DRY RUN SIMULATION] 🧪`));
    console.log(chalk.yellow(`Action: Would execute arbitrage for ${pair.token0}/${pair.token1}`));
    console.log(chalk.white(`Size:   ${optimalSize.toFixed(4)} ${pair.token0}`));
    console.log(chalk.green(`Profit: $${netProfit.toFixed(2)}`));
    
    this.simulatedProfit += netProfit;
    console.log(chalk.blue.bold(`📈 Total Simulated Profit: $${this.simulatedProfit.toFixed(2)}`));
    console.log(chalk.gray(`(No gas spent, no contract needed in Dry Run mode)\n`));
  }

  async checkPair(pair) {
    const { bestSize, maxNetProfit } = await this.findOptimalSize(pair);
    if (maxNetProfit > 0) {
      this.opportunitiesFound++;
      this.displayOpportunity({
        pair: `${pair.token0}/${pair.token1}`,
        optimalSize: bestSize.toFixed(4),
        netProfit: maxNetProfit.toFixed(2),
        token0: pair.token0,
        token1: pair.token1
      });
      
      // In Dry Run, we "execute" if it passes the threshold
      if (maxNetProfit > config.settings.executionThreshold) {
        await this.executeArbitrage(pair, bestSize, maxNetProfit);
      }
    }
  }

  displayOpportunity(opp) {
    console.log(chalk.cyan(`[SCAN] Found Opportunity: ${opp.pair} | Profit: $${opp.netProfit}`));
  }

  async monitor() {
    console.log(chalk.blue.bold('\n🤖 Base Arbitrage Bot: DRY RUN ACTIVE'));
    console.log(chalk.gray('Monitoring 55+ pairs for live opportunities...\n'));
    this.isRunning = true;
    while (this.isRunning) {
      await Promise.all(config.pairs.map(pair => this.checkPair(pair)));
      await new Promise(r => setTimeout(r, config.settings.updateInterval));
    }
  }

  async start() {
    try {
      const network = await this.provider.getNetwork();
      console.log(chalk.green(`✅ Connected to Base Network (Chain ID: ${network.chainId})`));
      console.log(chalk.yellow(`⚠️  MODE: DRY RUN (Simulating trades only)`));
    } catch (error) {
      console.error(chalk.red('❌ Connection Verification Failed:'), error.message);
      process.exit(1);
    }
    await this.monitor();
  }
}

module.exports = ArbitrageBot;
