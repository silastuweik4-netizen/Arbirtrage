// ArbitrageBot.js - COMPLETE VERSION with full logging (green quotes, gray profits, magenta spreads, blue BTC/LST watch)
const { ethers } = require('ethers');
const chalk = require('chalk');
const config = require('./config');
const { QUOTER_V2_ABI, AERODROME_ROUTER_ABI } = require('./abis');

const SLIPPAGE_TOLERANCE_BPS = config.settings.slippageToleranceBps || 80;

class ArbitrageBot {
  constructor() {
    const scanRpcUrl = config.BASE_RPC_URL;
    const chainId = config.CHAIN_ID || 8453;
    const executionRpcUrl = config.FLASHBOTS_RPC_URL || config.BASE_RPC_URL;
    const privateKey = process.env.PRIVATE_KEY || config.PRIVATE_KEY;

    console.log(chalk.blue(`📡 Initializing Bot for Base Chain (ID ${chainId})...`));

    try {
      this.provider = new ethers.FallbackProvider([
        new ethers.JsonRpcProvider(scanRpcUrl, chainId, { staticNetwork: true }),
        new ethers.JsonRpcProvider('https://mainnet.base.org', chainId, { staticNetwork: true })
      ]);
      this.executionProvider = new ethers.JsonRpcProvider(executionRpcUrl, chainId, { staticNetwork: true });

      if (privateKey) {
        this.wallet = new ethers.Wallet(privateKey, this.executionProvider);
        console.log(chalk.green(`✅ Wallet loaded: ${this.wallet.address}`));
      } else {
        console.warn(chalk.yellow('⚠️  No Private Key found. Bot in READ-ONLY mode.'));
      }
    } catch (error) {
      console.error(chalk.red('❌ Initialization Failed:'), error.message);
      process.exit(1);
    }

    this.uniswapQuoter = new ethers.Contract(config.contracts.uniswapQuoterV2, QUOTER_V2_ABI, this.provider);
    this.aerodromeRouter = new ethers.Contract(config.contracts.aerodromeRouter, AERODROME_ROUTER_ABI, this.provider);
    this.uniswapFactory = new ethers.Contract(config.contracts.uniswapFactory, ['function getPool(address, address, uint24) view returns (address)'], this.provider);
    this.sushiQuoter = new ethers.Contract(config.contracts.sushiQuoter, QUOTER_V2_ABI, this.provider);
    this.sushiFactory = new ethers.Contract(config.contracts.sushiFactory, ['function getPool(address, address, uint24) view returns (address)'], this.provider);

    this.arbitrageContract = new ethers.Contract(
      config.contracts.arbitrageContract,
      ['function initiateFlashloan(tuple(address tokenBorrow, uint256 amountBorrow, address tokenIn, address tokenOut, uint256 minAmountOut, bytes swapDataA_Uni, bytes swapDataA_Aero, bytes swapDataA_Sushi, bytes swapDataB_Uni, bytes swapDataB_Aero, bytes swapDataB_Sushi)) external'],
      this.wallet || this.executionProvider
    );

    this.isRunning = false;
    this.activeChecks = 0;
    this.maxConcurrentChecks = config.settings.maxConcurrentChecks || 4;
    
    this.executionCount = 0;
    this.hasExecutedSuccessfully = false;
  }

  formatAmount(amount, decimals) { return ethers.formatUnits(amount, decimals); }
  parseAmount(amount, decimals) { 
    const fixedAmount = parseFloat(amount).toFixed(decimals);
    return ethers.parseUnits(fixedAmount, decimals); 
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async retryCall(fn, maxRetries = 3, backoffMs = 1000) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (e) {
        if (e.code !== 429 && i === maxRetries - 1) throw e;
        await this.delay(backoffMs * (i + 1));
      }
    }
  }

  async checkBalanceSufficient() {
    if (!this.wallet) return true;
    
    const balance = await this.executionProvider.getBalance(this.wallet.address);
    const ethBalance = parseFloat(ethers.formatEther(balance));
    const minBalance = config.settings.minBalanceToOperate || 0.001;
    
    if (ethBalance < minBalance) {
      console.log(chalk.red(`\n❌ INSUFFICIENT BALANCE: ${ethBalance.toFixed(6)} ETH`));
      return false;
    }
    
    return true;
  }

  async uniswapPoolExists(tokenIn, tokenOut, fee) {
    try {
      const pool = await this.uniswapFactory.getPool(tokenIn.address, tokenOut.address, fee);
      return pool !== ethers.ZeroAddress;
    } catch {
      return false;
    }
  }

  async sushiPoolExists(tokenIn, tokenOut, fee) {
    try {
      const pool = await this.sushiFactory.getPool(tokenIn.address, tokenOut.address, fee);
      return pool !== ethers.ZeroAddress;
    } catch {
      return false;
    }
  }

  async getUniswapQuote(tokenIn, tokenOut, amountIn, fee) {
    if (!await this.uniswapPoolExists(tokenIn, tokenOut, fee)) {
      console.log(chalk.yellow(`No Uniswap pool for ${tokenIn.symbol}/${tokenOut.symbol} at fee ${fee}`));
      return { success: false, amountOut: null };
    }
    return this.retryCall(async () => {
      const params = {
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountIn: this.parseAmount(amountIn, tokenIn.decimals),
        fee: fee,
        sqrtPriceLimitX96: 0
      };
      const result = await this.uniswapQuoter.quoteExactInputSingle.staticCall(params);
      console.log(chalk.green(`Uniswap quote SUCCESS: ${tokenIn.symbol} → ${tokenOut.symbol} @ ${fee} | ${amountIn} → ${ethers.formatUnits(result.amountOut, tokenOut.decimals)}`));
      return { amountOut: result.amountOut, success: true };
    });
  }

  async getSushiQuote(tokenIn, tokenOut, amountIn, fee) {
    if (!await this.sushiPoolExists(tokenIn, tokenOut, fee)) {
      console.log(chalk.yellow(`No SushiSwap pool for ${tokenIn.symbol}/${tokenOut.symbol} at fee ${fee}`));
      return { success: false, amountOut: null };
    }
    return this.retryCall(async () => {
      const params = {
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountIn: this.parseAmount(amountIn, tokenIn.decimals),
        fee: fee,
        sqrtPriceLimitX96: 0
      };
      const result = await this.sushiQuoter.quoteExactInputSingle.staticCall(params);
      console.log(chalk.green(`SushiSwap quote SUCCESS: ${tokenIn.symbol} → ${tokenOut.symbol} @ ${fee} | ${amountIn} → ${ethers.formatUnits(result.amountOut, tokenOut.decimals)}`));
      return { amountOut: result.amountOut, success: true };
    });
  }

  async getAerodromeQuote(tokenIn, tokenOut, amountIn) {
    return this.retryCall(async () => {
      try {
        const routes = [{ 
          from: tokenIn.address, 
          to: tokenOut.address, 
          stable: false, 
          factory: config.contracts.aerodromeFactory 
        }];
        const amounts = await this.aerodromeRouter.getAmountsOut(
          this.parseAmount(amountIn, tokenIn.decimals), 
          routes
        );
        const outAmount = amounts[amounts.length - 1];
        console.log(chalk.green(`Aerodrome quote SUCCESS: ${tokenIn.symbol} → ${tokenOut.symbol} | ${amountIn} → ${ethers.formatUnits(outAmount, tokenOut.decimals)}`));
        return { amountOut: outAmount, success: true };
      } catch (e) {
        console.error(chalk.red(`Aerodrome quote FAILED for ${tokenIn.symbol}→${tokenOut.symbol}:`), e.shortMessage || e.message);
        return { success: false, amountOut: null };
      }
    });
  }

  async calculateNetProfit(tokenIn, tokenOut, amountIn, fee, pair) {
    const quotes = await Promise.allSettled([
      this.getUniswapQuote(tokenIn, tokenOut, amountIn, fee),
      this.getSushiQuote(tokenIn, tokenOut, amountIn, fee),
      this.getAerodromeQuote(tokenIn, tokenOut, amountIn)
    ]);

    const successfulQuotes = quotes
      .filter(r => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value);

    if (successfulQuotes.length === 0) return -1;

    const bestA = successfulQuotes.reduce((best, curr) => curr.amountOut > best.amountOut ? curr : best, successfulQuotes[0]);
    const amountOutA = bestA.amountOut;

    const reverseQuotes = await Promise.allSettled([
      this.getUniswapQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals), fee),
      this.getSushiQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals), fee),
      this.getAerodromeQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals))
    ]);

    const bestB = reverseQuotes
      .filter(r => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value)
      .reduce((best, curr) => curr.amountOut > best.amountOut ? curr : best, { amountOut: 0n });

    const amountOutB = bestB.amountOut;

    const amountInBN = this.parseAmount(amountIn, tokenIn.decimals);
    const flashloanFeeBN = (amountInBN * 5n) / 10000n;
    const netProfitBN = amountOutB - amountInBN - flashloanFeeBN;

    // Logging
    console.log(chalk.gray(
      `[${new Date().toISOString()}] Profit calc ${amountIn} ${tokenIn.symbol} → ${tokenOut.symbol}: ` +
      `${netProfitBN > 0n ? '+' : ''}${parseFloat(ethers.formatUnits(netProfitBN, tokenIn.decimals)).toFixed(6)}`
    ));

    // Cross-DEX spread for BTC/LST pairs
    if (pair.name.includes('cbBTC') || pair.name.includes('cbETH') || pair.name.includes('wstETH') || pair.name.includes('rETH')) {
      if (quotes[0].value?.success && quotes[2].value?.success) { // Uniswap vs Aerodrome
        const spreadPct = ((quotes[0].value.amountOut - quotes[2].value.amountOut) / quotes[2].value.amountOut) * 100;
        console.log(chalk.magenta(
          `[BTC/LST CROSS] ${pair.name} Uniswap vs Aerodrome spread: ${spreadPct.toFixed(3)}% ` +
          `(positive = Uniswap higher)`
        ));
      }
    }

    return netProfitBN > 0n ? parseFloat(ethers.formatUnits(netProfitBN, tokenIn.decimals)) : -1;
  }

  async checkPair(pair) {
    if (pair.name.includes('cbBTC') || pair.name.includes('cbETH') || pair.name.includes('wstETH') || pair.name.includes('rETH')) {
      console.log(chalk.blue(`[BTC/LST WATCH] Starting check for ${pair.name} @ fee ${pair.fee}`));
    } else {
      console.log(chalk.gray(`[${new Date().toISOString()}] Starting check for ${pair.name}`));
    }

    while (this.activeChecks >= this.maxConcurrentChecks) {
      await this.delay(200);
    }
    
    this.activeChecks++;
    
    try {
      const { bestSize, maxNetProfit } = await this.findOptimalSize(pair);
      
      if (maxNetProfit > config.settings.executionThreshold) {
        console.log(chalk.yellow.bold(`[DETECTED] Potential arb on ${pair.name}: $${maxNetProfit.toFixed(4)}`));
        // Do NOT execute – just log
      }
    } catch (error) {
      console.error(chalk.red(`Pair Check Error (${pair.name}):`), error.message);
    } finally {
      this.activeChecks--;
    }
  }

  async findOptimalSize(pair) {
    const token0 = config.tokens[pair.token0];
    const token1 = config.tokens[pair.token1];
    const maxSize = config.settings.depthAmount || 20;
    
    let bestSize = 0;
    let maxNetProfit = -Infinity;
    
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const testSize = (maxSize / steps) * i;
      const netProfit = await this.calculateNetProfit(token0, token1, testSize, pair.fee, pair);
      
      if (netProfit > maxNetProfit) {
        maxNetProfit = netProfit;
        bestSize = testSize;
      }
      
      await this.delay(200);
    }
    
    return { bestSize, maxNetProfit };
  }

  async monitor() {
    console.log(chalk.blue.bold('\n🤖 Base Arbitrage Detector Started'));
    console.log(chalk.gray(`Monitoring ${config.pairs.length} BTC/LST pairs...`));
    console.log(chalk.gray(`Detection threshold: $${config.settings.executionThreshold} (logging only – no execution)`));
    console.log(chalk.cyan(`📊 Slippage Tolerance: ${(SLIPPAGE_TOLERANCE_BPS / 100).toFixed(2)}%`));
    console.log('');
    
    this.isRunning = true;
    
    while (this.isRunning) {
      for (const pair of config.pairs) {
        if (!this.isRunning) break;
        
        this.checkPair(pair).catch(() => {});
        await this.delay(config.settings.delayBetweenChecks || 150);
      }
      
      while (this.activeChecks > 0) {
        await this.delay(200);
      }
      
      await this.delay(config.settings.scanInterval);
    }
  }

  async start() {
    try {
      const network = await this.provider.getNetwork();
      console.log(chalk.green(`✅ Connected to Base Network (Chain ID: ${network.chainId})`));
      
      if (this.wallet) {
        const balance = await this.executionProvider.getBalance(this.wallet.address);
        const ethBalance = ethers.formatEther(balance);
        console.log(chalk.cyan(`💰 Wallet Balance: ${parseFloat(ethBalance).toFixed(6)} ETH`));
      }
    } catch (error) {
      console.error(chalk.red('❌ Connection Failed:'), error.message);
      process.exit(1);
    }
    
    await this.monitor();
  }
  
  stop() {
    console.log(chalk.yellow('\n⏹️  Stopping detector...'));
    this.isRunning = false;
    
    setTimeout(() => {
      console.log(chalk.gray('✅ Detector stopped gracefully\n'));
      process.exit(0);
    }, 2000);
  }
}

module.exports = ArbitrageBot;
