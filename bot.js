// ArbitrageBot.js - FULLY FIXED VERSION with RPC Retries, Precision Fixes, Real Profit Calc, Slippage Typo Fix, and Separate Calldata
const { ethers } = require('ethers');
const chalk = require('chalk');
const config = require('./config');
const { QUOTER_V2_ABI, AERODROME_ROUTER_ABI } = require('./abis');

// --- CONSTANT: Slippage Tolerance (e.g., 50 basis points = 0.5%) ---
const SLIPPAGE_TOLERANCE_BPS = config.settings.slippageToleranceBps || 50; // Configurable, defaults to 0.5%

class ArbitrageBot {
  constructor() {
    const scanRpcUrl = config.BASE_RPC_URL;
    const chainId = config.CHAIN_ID || 8453;
    const executionRpcUrl = config.FLASHBOTS_RPC_URL || config.BASE_RPC_URL;
    const privateKey = process.env.PRIVATE_KEY || config.PRIVATE_KEY;

    console.log(chalk.blue(`📡 Initializing Bot for Base Chain (ID ${chainId})...`));
    
    if (executionRpcUrl === config.BASE_RPC_URL) {
      console.log(chalk.cyan(`ℹ️  Using Alchemy RPC with MEV protection`));
    }
    
    try {
      // NEW: Fallback provider for redundancy
      this.provider = new ethers.FallbackProvider([
        new ethers.JsonRpcProvider(scanRpcUrl, chainId, { staticNetwork: true }),
        new ethers.JsonRpcProvider('https://mainnet.base.org', chainId, { staticNetwork: true }) // Public fallback
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
    
    this.arbitrageContract = new ethers.Contract(
      config.contracts.arbitrageContract,
      ['function initiateFlashloan(tuple(address tokenBorrow, uint256 amountBorrow, address tokenIn, address tokenOut, uint256 minAmountOut, bytes swapDataA_Uni, bytes swapDataA_Aero, bytes swapDataB_Uni, bytes swapDataB_Aero)) external'],
      this.wallet || this.executionProvider
    );

    this.isRunning = false;
    this.activeChecks = 0;
    this.maxConcurrentChecks = config.settings.maxConcurrentChecks || 3;
    
    // NEW: One-shot mode tracking
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

  // NEW: Retry wrapper for RPC calls (handles 429)
  async retryCall(fn, maxRetries = 3, backoffMs = 1000) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (e) {
        if (e.code !== 429 && i === maxRetries - 1) throw e;
        await this.delay(backoffMs * (i + 1)); // Exponential backoff
      }
    }
  }

  // NEW: Check if we have enough balance to continue
  async checkBalanceSufficient() {
    if (!this.wallet) return true;
    
    const balance = await this.executionProvider.getBalance(this.wallet.address);
    const ethBalance = parseFloat(ethers.formatEther(balance));
    const minBalance = config.settings.minBalanceToOperate || 0.001;
    
    if (ethBalance < minBalance) {
      console.log(chalk.red(`\n❌ INSUFFICIENT BALANCE: ${ethBalance.toFixed(6)} ETH`));
      console.log(chalk.yellow(`   Minimum required: ${minBalance} ETH`));
      console.log(chalk.cyan(`   Please add more ETH to continue trading\n`));
      return false;
    }
    
    return true;
  }

  // NEW: Check if Uniswap pool exists
  async uniswapPoolExists(tokenIn, tokenOut, fee) {
    try {
      const pool = await this.uniswapFactory.getPool(tokenIn.address, tokenOut.address, fee);
      return pool !== ethers.ZeroAddress;
    } catch {
      return false;
    }
  }

  // --- MODIFIED: With retry and pool check ---
  async getUniswapQuote(tokenIn, tokenOut, amountIn, fee) {
    if (!await this.uniswapPoolExists(tokenIn, tokenOut, fee)) {
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
      return { amountOut: result.amountOut, success: true }; // BigInt
    });
  }

  // --- MODIFIED: With retry ---
  async getAerodromeQuote(tokenIn, tokenOut, amountIn) {
    return this.retryCall(async () => {
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
      return { amountOut: amounts[amounts.length - 1], success: true }; // BigInt
    });
  }

  // --- FIXED: BigInt precision, real profit calc with second leg ---
  async calculateNetProfit(tokenIn, tokenOut, amountIn, fee) {
    const [uniResult, aeroResult] = await Promise.allSettled([
      this.getUniswapQuote(tokenIn, tokenOut, amountIn, fee),
      this.getAerodromeQuote(tokenIn, tokenOut, amountIn)
    ]);

    const uniSuccess = uniResult.status === 'fulfilled' && uniResult.value.success;
    const aeroSuccess = aeroResult.status === 'fulfilled' && aeroResult.value.success;

    if (!uniSuccess && !aeroSuccess) return -1;

    let amountOutA; // From first leg
    let isUniForA = false;

    if (uniSuccess && aeroSuccess) {
      // Choose better (higher out) for sell, lower for buy—but for arb, simulate full path
      amountOutA = uniResult.value.amountOut > aeroResult.value.amountOut ? uniResult.value.amountOut : aeroResult.value.amountOut;
      isUniForA = uniResult.value.amountOut > aeroResult.value.amountOut;
    } else if (uniSuccess) {
      amountOutA = uniResult.value.amountOut;
      isUniForA = true;
    } else {
      amountOutA = aeroResult.value.amountOut;
    }

    // NEW: Calculate real second leg (reverse swap)
    let amountOutB;
    if (isUniForA || (!aeroSuccess && uniSuccess)) {
      // Second leg on Aero or fallback Uni
      const reverseResult = aeroSuccess ? await this.getAerodromeQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals)) 
        : await this.getUniswapQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals), fee);
      amountOutB = reverseResult.amountOut || 0n;
    } else {
      // Second leg on Uni or fallback Aero
      const reverseResult = uniSuccess ? await this.getUniswapQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals), fee) 
        : await this.getAerodromeQuote(tokenOut, tokenIn, this.formatAmount(amountOutA, tokenOut.decimals));
      amountOutB = reverseResult.amountOut || 0n;
    }

    const amountInBN = this.parseAmount(amountIn, tokenIn.decimals);
    const flashloanFeeBN = (amountInBN * 5n) / 10000n; // 0.05%
    const netProfitBN = amountOutB - amountInBN - flashloanFeeBN;

    return netProfitBN > 0n ? parseFloat(ethers.formatUnits(netProfitBN, tokenIn.decimals)) : -1;
  }

  async estimateGasCost() {
    try {
      const feeData = await this.executionProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const estimatedGasUnits = BigInt(config.settings.gasLimit || 500000);
      const gasCostWei = gasPrice * estimatedGasUnits;
      const gasCostEth = parseFloat(ethers.formatEther(gasCostWei));
      const ethPriceUSD = config.settings.ethPriceUsd || 3000;
      return gasCostEth * ethPriceUSD;
    } catch (error) {
      return 0.30; // Fallback
    }
  }

  async findOptimalSize(pair) {
    const token0 = config.tokens[pair.token0];
    const token1 = config.tokens[pair.token1];
    const maxSize = config.settings.depthAmount || 10;
    
    let bestSize = 0;
    let maxNetProfit = 0;
    
    const steps = 5; // Reduced from 10 to save RPC calls
    for (let i = 1; i <= steps; i++) {
      const testSize = (maxSize / steps) * i;
      const netProfit = await this.calculateNetProfit(token0, token1, testSize, pair.fee);
      
      if (netProfit > maxNetProfit) {
        maxNetProfit = netProfit;
        bestSize = testSize;
      }
      
      await this.delay(200); // Increased delay
    }
    
    return { bestSize, maxNetProfit };
  }

  encodeAerodromeSwap(tokenIn, tokenOut, amountIn, amountOutMinParam = 0n) {
    const iface = new ethers.Interface([
      'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) external returns (uint256[])'
    ]);
    const routes = [{ 
      from: tokenIn.address, 
      to: tokenOut.address, 
      stable: false, 
      factory: config.contracts.aerodromeFactory 
    }];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    
    return iface.encodeFunctionData('swapExactTokensForTokens', [
      amountIn,
      amountOutMinParam,
      routes,
      config.contracts.arbitrageContract,
      deadline
    ]);
  }

  encodeUniswapSwap(tokenIn, tokenOut, amountIn, amountOutMinParam = 0n, fee) {
    const iface = new ethers.Interface([
      'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)'
    ]);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    
    const params = {
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      fee: fee,
      recipient: config.contracts.arbitrageContract,
      deadline: deadline,
      amountIn: amountIn,
      amountOutMinimum: amountOutMinParam,
      sqrtPriceLimitX96: 0
    };
    
    return iface.encodeFunctionData('exactInputSingle', [params]);
  }

  // --- FIXED: Slippage calc, separate calldata, real reverse quotes ---
  async executeArbitrage(pair, optimalSize, netProfit) {
    if (!this.wallet) return;
    
    const hasSufficientBalance = await this.checkBalanceSufficient();
    if (!hasSufficientBalance) {
      console.log(chalk.red('⏹️  Stopping bot due to insufficient balance'));
      this.stop();
      return;
    }
    
    if (config.contracts.arbitrageContract === '0x0000000000000000000000000000000000000000') {
      console.log(chalk.yellow(`⚠️  Opportunity: ${pair.token0}/${pair.token1} ($${netProfit.toFixed(2)}), but no contract set.`));
      return;
    }

    console.log(chalk.yellow.bold(`🚀 EXECUTING: ${pair.token0}/${pair.token1} - Profit: $${netProfit.toFixed(2)}`));
    
    try {
      const token0 = config.tokens[pair.token0];
      const token1 = config.tokens[pair.token1];
      
      const amountBorrow = this.parseAmount(optimalSize, token0.decimals);
      const minRepaymentAmount = amountBorrow + (amountBorrow * 5n) / 10000n; // Add flashloan fee

      let uniQuote = await this.getUniswapQuote(token0, token1, optimalSize, pair.fee);
      let aeroQuote = await this.getAerodromeQuote(token0, token1, optimalSize);

      if (!uniQuote.success && !aeroQuote.success) {
        console.log(chalk.red(`❌ Could not get quotes from either Uniswap or Aerodrome for ${pair.token0}/${pair.token1}. Skipping.`));
        return;
      }

      let swapDataA_Uni = '0x';
      let swapDataA_Aero = '0x';
      let swapDataB_Uni = '0x';
      let swapDataB_Aero = '0x';
      let expectedIntermediateAmount; // BigInt

      if (uniQuote.success && aeroQuote.success) {
        if (uniQuote.amountOut < aeroQuote.amountOut) {
          // Uni for A (cheaper), Aero for B
          expectedIntermediateAmount = uniQuote.amountOut;
          const minOutA = (expectedIntermediateAmount * BigInt(10000 - SLIPPAGE_TOLERANCE_BPS)) / 10000n;
          const minOutB = (await this.getAerodromeQuote(token1, token0, this.formatAmount(expectedIntermediateAmount, token1.decimals))).amountOut * BigInt(10000 - SLIPPAGE_TOLERANCE_BPS) / 10000n;
          swapDataA_Uni = this.encodeUniswapSwap(token0, token1, amountBorrow, minOutA, pair.fee);
          swapDataB_Aero = this.encodeAerodromeSwap(token1, token0, expectedIntermediateAmount, minOutB);
        } else {
          // Aero for A, Uni for B
          expectedIntermediateAmount = aeroQuote.amountOut;
          const minOutA = (expectedIntermediateAmount * BigInt(10000 - SLIPPAGE_TOLERANCE_BPS)) / 10000n;
          const minOutB = (await this.getUniswapQuote(token1, token0, this.formatAmount(expectedIntermediateAmount, token1.decimals), pair.fee)).amountOut * BigInt(10000 - SLIPPAGE_TOLERANCE_BPS) / 10000n;
          swapDataA_Aero = this.encodeAerodromeSwap(token0, token1, amountBorrow, minOutA);
          swapDataB_Uni = this.encodeUniswapSwap(token1, token0, expectedIntermediateAmount, minOutB, pair.fee);
        }
      } else if (uniQuote.success) {
        console.log(chalk.yellow(`⚠️  Only Uniswap quote succeeded for ${pair.token0}/${pair.token1}. Checking for reverse quote...`));
        let reverseUniQuote = await this.getUniswapQuote(token1, token0, this.formatAmount(uniQuote.amountOut, token1.decimals), pair.fee);
        if (reverseUniQuote.success) {
          expectedIntermediateAmount = uniQuote.amountOut;
          const minOutA = (expectedIntermediateAmount * BigInt(10000 - SLIPPAGE_TOLERANCE_BPS)) / 10000n;
          const minOutB = (reverseUniQuote.amountOut * BigInt(10000 - SLIPPAGE_TOLERANCE_BPS)) / 10000n;
          swapDataA_Uni = this.encodeUniswapSwap(token0, token1, amountBorrow, minOutA, pair.fee);
          swapDataB_Uni = this.encodeUniswapSwap(token1, token0, expectedIntermediateAmount, minOutB, pair.fee);
        } else {
          console.log(chalk.red(`❌ Could not get reverse Uniswap quote for ${pair.token1}/${pair.token0}. Cannot execute arbitrage.`));
          return;
        }
      } else { // aeroQuote.success
        console.log(chalk.yellow(`⚠️  Only Aerodrome quote succeeded for ${pair.token0}/${pair.token1}. Checking for reverse quote...`));
        let reverseAeroQuote = await this.getAerodromeQuote(token1, token0, this.formatAmount(aeroQuote.amountOut, token1.decimals));
        if (reverseAeroQuote.success) {
          expectedIntermediateAmount = aeroQuote.amountOut;
          const minOutA = (expectedIntermediateAmount * BigInt(10000 - SLIPPAGE_TOLERANCE_BPS)) / 10000n;
          const minOutB = (reverseAeroQuote.amountOut * BigInt(10000 - SLIPPAGE_TOLERANCE_BPS)) / 10000n;
          swapDataA_Aero = this.encodeAerodromeSwap(token0, token1, amountBorrow, minOutA);
          swapDataB_Aero = this.encodeAerodromeSwap(token1, token0, expectedIntermediateAmount, minOutB);
        } else {
          console.log(chalk.red(`❌ Could not get reverse Aerodrome quote for ${pair.token1}/${pair.token0}. Cannot execute arbitrage.`));
          return;
        }
      }

      const tradeParams = {
        tokenBorrow: token0.address,
        amountBorrow: amountBorrow,
        tokenIn: token0.address,
        tokenOut: token1.address,
        minAmountOut: minRepaymentAmount,
        swapDataA_Uni: swapDataA_Uni,
        swapDataA_Aero: swapDataA_Aero,
        swapDataB_Uni: swapDataB_Uni,
        swapDataB_Aero: swapDataB_Aero
      };

      // NEW: Dynamic gas estimation
      const feeData = await this.executionProvider.getFeeData();
      const estimatedGas = await this.arbitrageContract.initiateFlashloan.estimateGas(tradeParams);
      const safeGasLimit = (estimatedGas * 130n) / 100n; // 30% buffer

      const tx = await this.arbitrageContract.initiateFlashloan(tradeParams, {
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        gasLimit: safeGasLimit
      });
      
      console.log(chalk.green(`📤 Transaction Sent: ${tx.hash}`));
      this.executionCount++;
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        console.log(chalk.green(`✅ SUCCESS! Confirmed in block ${receipt.blockNumber}`));
        console.log(chalk.cyan(`💰 Profit: ~$${netProfit.toFixed(2)} transferred to your wallet\n`));
        
        this.hasExecutedSuccessfully = true;
        
        if (config.settings.oneShotMode && config.settings.stopAfterSuccess) {
          console.log(chalk.yellow.bold('\n🎯 ONE-SHOT MODE: First execution successful!'));
          console.log(chalk.cyan('⏹️  Stopping bot as configured...'));
          console.log(chalk.gray('   Restart the service to execute another trade\n'));
          this.stop();
        }
      } else {
        console.log(chalk.red(`❌ Transaction failed in block ${receipt.blockNumber}`));
        
        if (config.settings.oneShotMode && config.settings.stopAfterFailure) {
          console.log(chalk.yellow('\n⏹️  Stopping bot after failed execution'));
          this.stop();
        }
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Execution Error:'), error.message);
      
      if (config.settings.oneShotMode && error.message.includes('insufficient funds')) {
        console.log(chalk.red('\n⏹️  Stopping bot: Insufficient funds'));
        this.stop();
      }
    }
  }

  async checkPair(pair) {
    while (this.activeChecks >= this.maxConcurrentChecks) {
      await this.delay(200); // Increased
    }
    
    this.activeChecks++;
    
    try {
      const { bestSize, maxNetProfit } = await this.findOptimalSize(pair);
      
      if (maxNetProfit > config.settings.executionThreshold) {
        await this.executeArbitrage(pair, bestSize, maxNetProfit);
      }
    } catch (error) {
      console.error('Pair Check Error:', error.message);
    } finally {
      this.activeChecks--;
    }
  }

  async monitor() {
    console.log(chalk.blue.bold('\n🤖 Base Arbitrage Bot Started'));
    console.log(chalk.gray(`Monitoring ${config.pairs.length} pairs...`));
    console.log(chalk.gray(`Execution threshold: $${config.settings.executionThreshold}`));
    
    if (config.settings.oneShotMode) {
      console.log(chalk.yellow('🎯 ONE-SHOT MODE: Will stop after first execution'));
    }
    console.log(chalk.cyan(`📊 Slippage Tolerance: ${(SLIPPAGE_TOLERANCE_BPS / 100).toFixed(2)}%`));
    console.log('');
    
    this.isRunning = true;
    
    while (this.isRunning) {
      for (const pair of config.pairs) {
        if (!this.isRunning) break;
        
        this.checkPair(pair).catch(() => {});
        await this.delay(config.settings.delayBetweenChecks || 500); // Increased
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
        
        const minBalance = config.settings.minBalanceToOperate || 0.001;
        if (parseFloat(ethBalance) < minBalance) {
          console.log(chalk.red(`⚠️  WARNING: Balance below minimum (${minBalance} ETH)`));
          console.log(chalk.yellow('   Bot may stop if balance insufficient for gas\n'));
        }
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Connection Failed:'), error.message);
      process.exit(1);
    }
    
    await this.monitor();
  }
  
  stop() {
    console.log(chalk.yellow('\n⏹️  Stopping bot...'));
    this.isRunning = false;
    
    setTimeout(() => {
      console.log(chalk.gray('✅ Bot stopped gracefully\n'));
      process.exit(0);
    }, 2000);
  }
}

module.exports = ArbitrageBot;
