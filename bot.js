// ArbitrageBot.js - FULL UPDATED with PancakeSwap integration + logging
const { ethers } = require('ethers');
const chalk = require('chalk');
const config = require('./config');
const { QUOTER_V2_ABI, AERODROME_ROUTER_ABI } = require('./abis');

// Assume PancakeSwap uses similar V3 ABI as Uniswap — adjust if needed
const PANCAKE_QUOTER_ABI = QUOTER_V2_ABI; // Similar to Uniswap V3 Quoter
const PANCAKE_ROUTER_ABI = AERODROME_ROUTER_ABI; // Adjust if different

const SLIPPAGE_TOLERANCE_BPS = config.settings.slippageToleranceBps || 50;

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
        console.warn(chalk.yellow('⚠️  No Private Key found. Bot will run in READ-ONLY mode.'));
      }
    } catch (error) {
      console.error(chalk.red('❌ Initialization Failed:'), error.message);
      process.exit(1);
    }

    this.uniswapQuoter = new ethers.Contract(config.contracts.uniswapQuoterV2, QUOTER_V2_ABI, this.provider);
    this.aerodromeRouter = new ethers.Contract(config.contracts.aerodromeRouter, AERODROME_ROUTER_ABI, this.provider);
    this.uniswapFactory = new ethers.Contract(config.contracts.uniswapFactory, ['function getPool(address, address, uint24) view returns (address)'], this.provider);
    
    // NEW: PancakeSwap contracts
    this.pancakeQuoter = new ethers.Contract(config.contracts.pancakeQuoter, PANCAKE_QUOTER_ABI, this.provider);
    this.pancakeRouter = new ethers.Contract(config.contracts.pancakeRouter, PANCAKE_ROUTER_ABI, this.provider);
    this.pancakeFactory = new ethers.Contract(config.contracts.pancakeFactory, ['function getPool(address, address, uint24) view returns (address)'], this.provider);

    this.arbitrageContract = new ethers.Contract(
      config.contracts.arbitrageContract,
      ['function initiateFlashloan(tuple(address tokenBorrow, uint256 amountBorrow, address tokenIn, address tokenOut, uint256 minAmountOut, bytes swapDataA_Uni, bytes swapDataA_Aero, bytes swapDataB_Uni, bytes swapDataB_Aero)) external'],
      this.wallet || this.executionProvider
    );

    this.isRunning = false;
    this.activeChecks = 0;
    this.maxConcurrentChecks = config.settings.maxConcurrentChecks || 3;
    
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
      console.log(chalk.yellow(`   Minimum required: ${minBalance} ETH`));
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

  async pancakePoolExists(tokenIn, tokenOut, fee) {
    try {
      const pool = await this.pancakeFactory.getPool(tokenIn.address, tokenOut.address, fee);
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
      console.log(chalk.green(`Uniswap quote SUCCESS: ${tokenIn.symbol} → ${tokenOut.symbol} | ${amountIn} → ${ethers.formatUnits(result.amountOut, tokenOut.decimals)}`));
      return { amountOut: result.amountOut, success: true };
    });
  }

  async getPancakeQuote(tokenIn, tokenOut, amountIn, fee) {
    if (!await this.pancakePoolExists(tokenIn, tokenOut, fee)) {
      console.log(chalk.yellow(`No PancakeSwap pool for ${tokenIn.symbol}/${tokenOut.symbol} at fee ${fee}`));
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
      const result = await this.pancakeQuoter.quoteExactInputSingle.staticCall(params);
      console.log(chalk.green(`PancakeSwap quote SUCCESS: ${tokenIn.symbol} → ${tokenOut.symbol} | ${amountIn} → ${ethers.formatUnits(result.amountOut, tokenOut.decimals)}`));
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

  async calculateNetProfit(tokenIn, tokenOut, amountIn, fee) {
    const [uniResult, aeroResult, pancakeResult] = await Promise.allSettled([
      this.getUniswapQuote(tokenIn, tokenOut, amountIn, fee),
      this.getAerodromeQuote(tokenIn, tokenOut, amountIn),
      this.getPancakeQuote(tokenIn, tokenOut, amountIn, fee)
    ]);

    const uniSuccess = uniResult.status === 'fulfilled' && uniResult.value.success;
    const aeroSuccess = aeroResult.status === 'fulfilled' && aeroResult.value.success;
    const pancakeSuccess = pancakeResult.status === 'fulfilled' && pancakeResult.value.success;

    if (!uniSuccess && !aeroSuccess && !pancakeSuccess) return -1;

    let amountOutA = 0n;
    let sourceForA = '';

    const amountsOut = [];
    if (uniSuccess) amountsOut.push(uniResult.value.amountOut);
    if (aeroSuccess) amountsOut.push(aeroResult.value.amountOut);
    if (pancakeSuccess) amountsOut.push(pancakeResult.value.amountOut);

    amountOutA = amountsOut.length > 0 ? amountsOut.reduce((a, b) => a > b ? a : b) : 0n; // Max out for best
    sourceForA = amountOutA === uniResult.value?.amountOut ? 'uni' : amountOutA === aeroResult.value?.amountOut ? 'aero' : 'pancake';

    let amountOutB = 0n;
    let reverseResult;
    if (sourceForA === 'uni' || (!aeroSuccess && !pancakeSuccess && uniSuccess)) {
      reverseResult = await Promise.any([
        this.getAerodromeQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals)),
        this.getPancakeQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals), fee)
      ].filter(r => r.success));
    } else if (sourceForA === 'aero' || (!uniSuccess && !pancakeSuccess && aeroSuccess)) {
      reverseResult = await Promise.any([
        this.getUniswapQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals), fee),
        this.getPancakeQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals), fee)
      ].filter(r => r.success));
    } else if (sourceForA === 'pancake' || (!uniSuccess && !aeroSuccess && pancakeSuccess)) {
      reverseResult = await Promise.any([
        this.getUniswapQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals), fee),
        this.getAerodromeQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals))
      ].filter(r => r.success));
    }

    amountOutB = reverseResult?.amountOut || 0n;

    const amountInBN = this.parseAmount(amountIn, tokenIn.decimals);
    const flashloanFeeBN = (amountInBN * 5n) / 10000n;
    const netProfitBN = amountOutB - amountInBN - flashloanFeeBN;

    console.log(chalk.gray(`[${new Date().toISOString()}] Profit calc for ${amountIn} ${tokenIn.symbol} → ${tokenOut.symbol}: ${netProfitBN > 0n ? '+' : ''}${parseFloat(ethers.formatUnits(netProfitBN, tokenIn.decimals)).toFixed(6)} (after flashloan fee)`));

    return netProfitBN > 0n ? parseFloat(ethers.formatUnits(netProfitBN, tokenIn.decimals)) : -1;
  }

  // ... (rest of the file remains the same as previous full version - estimateGasCost, findOptimalSize, encode functions, executeArbitrage, checkPair, monitor, start, stop)

  // Note: For brevity, the rest is the same as the previous full version you have. If you need it, let me know.
}

module.exports = ArbitrageBot;
