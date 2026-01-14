const { ethers } = require('ethers');
const chalk = require('chalk');
const config = require('./config');
const { QUOTER_V2_ABI, AERODROME_ROUTER_ABI } = require('./abis');

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
      this.provider = new ethers.JsonRpcProvider(scanRpcUrl, chainId, { staticNetwork: true });
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
    
    this.arbitrageContract = new ethers.Contract(
      config.contracts.arbitrageContract,
      ['function initiateFlashloan(tuple(address tokenBorrow, uint256 amountBorrow, address tokenIn, address tokenOut, uint256 minAmountOut, bytes swapDataA, bytes swapDataB)) external'],
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
    } catch (e) { 
      return { success: false }; 
    }
  }

  async getAerodromeQuote(tokenIn, tokenOut, amountIn) {
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
      return { amountOut: parseFloat(this.formatAmount(amounts[1], tokenOut.decimals)), success: true };
    } catch (e) { 
      return { success: false }; 
    }
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
    const flashloanFee = amountIn * buyPrice * 0.0005;
    const gasFee = await this.estimateGasCost();

    return grossProfit - flashloanFee - gasFee;
  }

  async estimateGasCost() {
    try {
      const feeData = await this.executionProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const estimatedGasUnits = BigInt(config.settings.gasLimit || 500000);
      const gasCostWei = gasPrice * estimatedGasUnits;
      const gasCostEth = parseFloat(ethers.formatEther(gasCostWei));
      const ethPriceUSD = 3000; // Approximate
      return gasCostEth * ethPriceUSD;
    } catch (error) {
      return 0.30;
    }
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
      
      await this.delay(50);
    }
    
    return { bestSize, maxNetProfit };
  }

  encodeAerodromeSwap(tokenIn, tokenOut, amountIn, amountOutMin) {
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
      amountOutMin,
      routes,
      config.contracts.arbitrageContract,
      deadline
    ]);
  }

  encodeUniswapSwap(tokenIn, tokenOut, amountIn, amountOutMin, fee) {
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
      amountOutMinimum: amountOutMin,
      sqrtPriceLimitX96: 0
    };
    
    return iface.encodeFunctionData('exactInputSingle', [params]);
  }

  async executeArbitrage(pair, optimalSize, netProfit) {
    if (!this.wallet) return;
    
    // NEW: Check balance before executing
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
      const minAmountOut = this.parseAmount(netProfit * 0.95, token0.decimals);

      const uniQuote = await this.getUniswapQuote(token0, token1, optimalSize, pair.fee);
      const aeroQuote = await this.getAerodromeQuote(token0, token1, optimalSize);
      
      let swapDataA, swapDataB;
      
      if (uniQuote.amountOut < aeroQuote.amountOut) {
        swapDataA = this.encodeUniswapSwap(token0, token1, amountBorrow, 0, pair.fee);
        const amountOutUni = this.parseAmount(uniQuote.amountOut, token1.decimals);
        swapDataB = this.encodeAerodromeSwap(token1, token0, amountOutUni, 0);
      } else {
        swapDataA = this.encodeAerodromeSwap(token0, token1, amountBorrow, 0);
        const amountOutAero = this.parseAmount(aeroQuote.amountOut, token1.decimals);
        swapDataB = this.encodeUniswapSwap(token1, token0, amountOutAero, 0, pair.fee);
      }

      const tradeParams = {
        tokenBorrow: token0.address,
        amountBorrow: amountBorrow,
        tokenIn: token0.address,
        tokenOut: token1.address,
        minAmountOut: minAmountOut,
        swapDataA: swapDataA,
        swapDataB: swapDataB
      };

      const feeData = await this.executionProvider.getFeeData();
      
      const tx = await this.arbitrageContract.initiateFlashloan(tradeParams, {
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        gasLimit: config.settings.gasLimit
      });
      
      console.log(chalk.green(`📤 Transaction Sent: ${tx.hash}`));
      this.executionCount++;
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        console.log(chalk.green(`✅ SUCCESS! Confirmed in block ${receipt.blockNumber}`));
        console.log(chalk.cyan(`💰 Profit: ~$${netProfit.toFixed(2)} transferred to your wallet\n`));
        
        this.hasExecutedSuccessfully = true;
        
        // NEW: One-shot mode - stop after first success
        if (config.settings.oneShotMode && config.settings.stopAfterSuccess) {
          console.log(chalk.yellow.bold('\n🎯 ONE-SHOT MODE: First execution successful!'));
          console.log(chalk.cyan('⏹️  Stopping bot as configured...'));
          console.log(chalk.gray('   Restart the service to execute another trade\n'));
          this.stop();
        }
      } else {
        console.log(chalk.red(`❌ Transaction failed in block ${receipt.blockNumber}`));
        
        // NEW: Stop if configured to stop on failure
        if (config.settings.oneShotMode && config.settings.stopAfterFailure) {
          console.log(chalk.yellow('\n⏹️  Stopping bot after failed execution'));
          this.stop();
        }
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Execution Error:'), error.message);
      
      // Stop on critical errors in one-shot mode
      if (config.settings.oneShotMode && error.message.includes('insufficient funds')) {
        console.log(chalk.red('\n⏹️  Stopping bot: Insufficient funds'));
        this.stop();
      }
    }
  }

  async checkPair(pair) {
    while (this.activeChecks >= this.maxConcurrentChecks) {
      await this.delay(100);
    }
    
    this.activeChecks++;
    
    try {
      const { bestSize, maxNetProfit } = await this.findOptimalSize(pair);
      
      if (maxNetProfit > config.settings.executionThreshold) {
        await this.executeArbitrage(pair, bestSize, maxNetProfit);
      }
    } catch (error) {
      // Silently handle to avoid log spam
    } finally {
      this.activeChecks--;
    }
  }

  async monitor() {
    console.log(chalk.blue.bold('\n🤖 Base Arbitrage Bot Started'));
    console.log(chalk.gray(`Monitoring ${config.pairs.length} pairs...`));
    console.log(chalk.gray(`Execution threshold: $${config.settings.executionThreshold}`));
    
    // NEW: Display one-shot mode status
    if (config.settings.oneShotMode) {
      console.log(chalk.yellow('🎯 ONE-SHOT MODE: Will stop after first execution'));
    }
    console.log('');
    
    this.isRunning = true;
    
    while (this.isRunning) {
      for (const pair of config.pairs) {
        if (!this.isRunning) break;
        
        this.checkPair(pair).catch(() => {});
        await this.delay(config.settings.delayBetweenChecks || 200);
      }
      
      while (this.activeChecks > 0) {
        await this.delay(100);
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
    
    // Give time for active checks to complete
    setTimeout(() => {
      console.log(chalk.gray('✅ Bot stopped gracefully\n'));
      process.exit(0);
    }, 2000);
  }
}

module.exports = ArbitrageBot;
