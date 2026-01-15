// ArbitrageBot.js - COMPLETE, SELF-CONTAINED (Uniswap V3 + Aerodrome only, full logging, no execution)
const { ethers } = require('ethers');
const chalk = require('chalk');
const config = require('./config');
const { QUOTER_V2_ABI, AERODROME_ROUTER_ABI } = require('./abis');

const SLIPPAGE_TOLERANCE_BPS = config.settings.slippageToleranceBps || 80;

class ArbitrageBot {
  constructor() {
    console.log(chalk.blue(`📡 Initializing Detector for Base Chain (ID ${config.CHAIN_ID})...`));

    try {
      this.provider = new ethers.FallbackProvider([
        new ethers.JsonRpcProvider(config.BASE_RPC_URL, config.CHAIN_ID, { staticNetwork: true }),
        new ethers.JsonRpcProvider('https://mainnet.base.org', config.CHAIN_ID, { staticNetwork: true })
      ]);
      this.executionProvider = new ethers.JsonRpcProvider(config.FLASHBOTS_RPC_URL || config.BASE_RPC_URL, config.CHAIN_ID, { staticNetwork: true });

      if (process.env.PRIVATE_KEY || config.PRIVATE_KEY) {
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY || config.PRIVATE_KEY, this.executionProvider);
        console.log(chalk.green(`✅ Wallet loaded: ${this.wallet.address}`));
      } else {
        console.warn(chalk.yellow('⚠️  No Private Key found. READ-ONLY mode.'));
      }
    } catch (error) {
      console.error(chalk.red('❌ Initialization Failed:'), error.message);
      process.exit(1);
    }

    this.uniswapQuoter = new ethers.Contract(config.contracts.uniswapQuoterV2, QUOTER_V2_ABI, this.provider);
    this.aerodromeRouter = new ethers.Contract(config.contracts.aerodromeRouter, AERODROME_ROUTER_ABI, this.provider);
    this.uniswapFactory = new ethers.Contract(config.contracts.uniswapFactory, ['function getPool(address, address, uint24) view returns (address)'], this.provider);

    this.arbitrageContract = new ethers.Contract(
      config.contracts.arbitrageContract,
      ['function initiateFlashloan(tuple(address tokenBorrow, uint256 amountBorrow, address tokenIn, address tokenOut, uint256 minAmountOut, bytes swapDataA, bytes swapDataB)) external'],
      this.wallet || this.executionProvider
    );

    this.isRunning = false;
    this.activeChecks = 0;
    this.maxConcurrentChecks = config.settings.maxConcurrentChecks || 4;
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

  async uniswapPoolExists(tokenIn, tokenOut, fee) {
    try {
      const pool = await this.uniswapFactory.getPool(tokenIn.address, tokenOut.address, fee);
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
    const [uniResult, aeroResult] = await Promise.allSettled([
      this.getUniswapQuote(tokenIn, tokenOut, amountIn, fee),
      this.getAerodromeQuote(tokenIn, tokenOut, amountIn)
    ]);

    const uniSuccess = uniResult.status === 'fulfilled' && uniResult.value.success;
    const aeroSuccess = aeroResult.status === 'fulfilled' && aeroResult.value.success;

    if (!uniSuccess && !aeroSuccess) return -1;

    let amountOutA = 0n;
    if (uniSuccess && aeroSuccess) {
      amountOutA = uniResult.value.amountOut > aeroResult.value.amountOut ? uniResult.value.amountOut : aeroResult.value.amountOut;
      const spreadPct = ((uniResult.value.amountOut - aeroResult.value.amountOut) / aeroResult.value.amountOut) * 100;
      console.log(chalk.magenta(
        `[CROSS-SPREAD] ${pair.name} Uniswap vs Aerodrome: ${spreadPct.toFixed(3)}% (positive = Uniswap higher)`
      ));
    } else if (uniSuccess) {
      amountOutA = uniResult.value.amountOut;
    } else {
      amountOutA = aeroResult.value.amountOut;
    }

    let amountOutB = 0n;
    const reverseUni = uniSuccess ? await this.getUniswapQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals), fee) : { success: false };
    const reverseAero = aeroSuccess ? await this.getAerodromeQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals)) : { success: false };

    if (reverseUni.success && reverseAero.success) {
      amountOutB = reverseUni.amountOut > reverseAero.amountOut ? reverseUni.amountOut : reverseAero.amountOut;
    } else if (reverseUni.success) {
      amountOutB = reverseUni.amountOut;
    } else if (reverseAero.success) {
      amountOutB = reverseAero.amountOut;
    }

    const amountInBN = this.parseAmount(amountIn, tokenIn.decimals);
    const flashloanFeeBN = (amountInBN * 5n) / 10000n;
    const netProfitBN = amountOutB - amountInBN - flashloanFeeBN;

    console.log(chalk.gray(
      `[${new Date().toISOString()}] Profit calc ${amountIn} ${tokenIn.symbol} → ${tokenOut.symbol}: ` +
      `${netProfitBN > 0n ? '+' : ''}${parseFloat(ethers.formatUnits(netProfitBN, tokenIn.decimals)).toFixed(6)}`
    ));

    return netProfitBN > 0n ? parseFloat(ethers.formatUnits(netProfitBN, tokenIn.decimals)) : -1;
  }

  async checkPair(pair) {
    console.log(chalk.gray(`[${new Date().toISOString()}] Checking ${pair.name} @ fee ${pair.fee}`));

    while (this.activeChecks >= this.maxConcurrentChecks) {
      await this.delay(200);
    }
    
    this.activeChecks++;
    
    try {
      const { bestSize, maxNetProfit } = await this.findOptimalSize(pair);
      
      if (maxNetProfit > config.settings.executionThreshold) {
        console.log(chalk.yellow.bold(`[DETECTED] Potential opportunity on ${pair.name}: $${maxNetProfit.toFixed(4)}`));
      } else {
        console.log(chalk.gray(`No opportunity on ${pair.name} (max profit: ${maxNetProfit.toFixed(4)})`));
      }
    } catch (error) {
      console.error(chalk.red(`Check failed for ${pair.name}:`), error.message);
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
    console.log(chalk.blue.bold('\n🤖 Aerodrome + Uniswap Detector Started'));
    console.log(chalk.gray(`Monitoring ${config.pairs.length} pairs...`));
    console.log(chalk.gray(`Detection threshold: $${config.settings.executionThreshold} (logging only)`));
    console.log(chalk.cyan(`📊 Slippage Tolerance: ${(SLIPPAGE_TOLERANCE_BPS / 100).toFixed(2)}%`));
    console.log('');
    
    this.isRunning = true;
    
    while (this.isRunning) {
      for (const pair of config.pairs) {
        if (!this.isRunning) break;
        
        await this.checkPair(pair);
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
        console.log(chalk.cyan(`💰 Wallet Balance: ${ethers.formatEther(balance)} ETH`));
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
      console.log(chalk.gray('✅ Detector stopped\n'));
      process.exit(0);
    }, 2000);
  }
}

module.exports = ArbitrageBot;
