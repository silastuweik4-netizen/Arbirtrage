const { ethers } = require('ethers');
const chalk = require('chalk');
const config = require('./config');
const { QUOTER_V2_ABI, AERODROME_ROUTER_ABI } = require('./abis');

class ArbitrageBot {
  constructor() {
    const scanRpcUrl = config.BASE_RPC_URL;
    const chainId = config.CHAIN_ID || 8453;
    const executionRpcUrl = config.FLASHBOTS_RPC_URL || 'https://rpc.flashbots.net/base';
    const privateKey = process.env.PRIVATE_KEY || config.PRIVATE_KEY;

    console.log(chalk.blue(`📡 Initializing MEV-Protected Bot for Chain ID ${chainId}...`));
    
    try {
      this.provider = new ethers.JsonRpcProvider(scanRpcUrl, chainId, { staticNetwork: true });
      this.executionProvider = new ethers.JsonRpcProvider(executionRpcUrl, chainId, { staticNetwork: true });
      
      if (privateKey) {
        this.wallet = new ethers.Wallet(privateKey, this.executionProvider);
        console.log(chalk.green(`✅ Wallet loaded: ${this.wallet.address}`));
      } else {
        console.warn(chalk.yellow('⚠️  No Private Key found. Bot will run in READ-ONLY mode.'));
        this.wallet = null;
      }
    } catch (error) {
      console.error(chalk.red('❌ Initialization Failed:'), error.message);
      process.exit(1);
    }

    // Debug: Log contract addresses
    console.log(chalk.cyan('📋 Contract Addresses:'));
    console.log(chalk.cyan(`  • Uniswap V3 Quoter: ${config.contracts.uniswapV3Quoter}`));
    console.log(chalk.cyan(`  • Aerodrome Router: ${config.contracts.aerodromeRouter}`));
    console.log(chalk.cyan(`  • Arbitrage Contract: ${config.contracts.arbitrageContract}`));

    try {
      // FIX: Use correct property name - uniswapV3Quoter instead of uniswapQuoterV2
      this.uniswapQuoter = new ethers.Contract(
        config.contracts.uniswapV3Quoter, 
        QUOTER_V2_ABI, 
        this.provider
      );
      console.log(chalk.green('✅ Uniswap V3 Quoter loaded'));

      this.aerodromeRouter = new ethers.Contract(
        config.contracts.aerodromeRouter, 
        AERODROME_ROUTER_ABI, 
        this.provider
      );
      console.log(chalk.green('✅ Aerodrome Router loaded'));
      
      // Only create arbitrage contract if we have a wallet AND a valid contract address
      if (this.wallet && config.contracts.arbitrageContract && 
          config.contracts.arbitrageContract !== '0x0000000000000000000000000000000000000000') {
        
        const ARBITRAGE_ABI = [
          "function initiateFlashloan(tuple(address tokenBorrow, uint256 amountBorrow, address tokenIn, address tokenOut, uint256 minAmountOut, bytes swapDataA, bytes swapDataB) params) external"
        ];
        
        this.arbitrageContract = new ethers.Contract(
          config.contracts.arbitrageContract,
          ARBITRAGE_ABI,
          this.wallet
        );
        console.log(chalk.green('✅ Arbitrage contract loaded'));
      } else {
        this.arbitrageContract = null;
        if (!this.wallet) {
          console.warn(chalk.yellow('⚠️  Arbitrage contract not loaded (no wallet - READ-ONLY mode)'));
        } else if (!config.contracts.arbitrageContract) {
          console.warn(chalk.yellow('⚠️  Arbitrage contract not loaded (no contract address in config)'));
        }
      }

    } catch (error) {
      console.error(chalk.red('❌ Contract initialization failed:'), error.message);
      if (error.code === 'INVALID_ARGUMENT') {
        console.error(chalk.red('  Invalid contract address detected. Check config.js'));
      }
      process.exit(1);
    }

    this.isRunning = false;
  }

  formatAmount(amount, decimals) { 
    return ethers.formatUnits(amount, decimals); 
  }
  
  parseAmount(amount, decimals) { 
    // FIX 1: Ensure we don't have too many decimals before parsing
    const fixedAmount = parseFloat(amount).toFixed(decimals);
    return ethers.parseUnits(fixedAmount, decimals); 
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
      console.warn(chalk.yellow(`⚠️  Uniswap quote failed for ${tokenIn}/${tokenOut}: ${e.message}`));
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
      console.warn(chalk.yellow(`⚠️  Aerodrome quote failed for ${tokenIn}/${tokenOut}: ${e.message}`));
      return { success: false }; 
    }
  }

  async calculateNetProfit(tokenIn, tokenOut, amountIn, fee) {
    const [uni, aero] = await Promise.all([
      this.getUniswapQuote(tokenIn, tokenOut, amountIn, fee),
      this.getAerodromeQuote(tokenIn, tokenOut, amountIn)
    ]);

    if (!uni.success || !aero.success) {
      console.warn(chalk.yellow(`⚠️  Quote failed for ${tokenIn}/${tokenOut}`));
      return -1;
    }

    const buyPrice = Math.min(uni.amountOut / amountIn, aero.amountOut / amountIn);
    const sellPrice = Math.max(uni.amountOut / amountIn, aero.amountOut / amountIn);
    
    const grossProfit = (sellPrice - buyPrice) * amountIn;
    const flashloanFee = amountIn * buyPrice * 0.0005; // 0.05% flashloan fee
    const gasFee = 0.20; // Estimated gas cost in USD

    const netProfit = grossProfit - flashloanFee - gasFee;
    
    if (netProfit > 0) {
      console.log(chalk.cyan(`  → Potential profit: $${netProfit.toFixed(2)}`));
    }
    
    return netProfit;
  }

  async findOptimalSize(pair) {
    const token0 = config.tokens[pair.token0];
    const token1 = config.tokens[pair.token1];
    const maxSize = config.settings.maxFlashloanAmount || 10;
    
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
    // Check if we can execute (have wallet and contract)
    if (!this.wallet || !this.arbitrageContract) {
      console.log(chalk.yellow(`⚠️  READ-ONLY MODE: Opportunity found for ${pair.name || `${pair.token0}/${pair.token1}`} ($${netProfit.toFixed(2)}), but no wallet or contract configured.`));
      return;
    }

    // SAFETY CHECK: Don't execute if contract address is default
    if (config.contracts.arbitrageContract === '0x0000000000000000000000000000000000000000') {
      console.log(chalk.yellow(`⚠️  Opportunity found for ${pair.name || `${pair.token0}/${pair.token1}`} ($${netProfit.toFixed(2)}), but no contract address is set.`));
      return;
    }

    console.log(chalk.yellow.bold(`🚀 EXECUTING MEV-PROTECTED ARBITRAGE: ${pair.name || `${pair.token0}/${pair.token1}`}`));
    
    try {
      const token0 = config.tokens[pair.token0];
      const token1 = config.tokens[pair.token1];
      
      const amountBorrow = this.parseAmount(optimalSize, token0.decimals);
      const minAmountOut = this.parseAmount(netProfit * 0.9, token0.decimals);

      const uniQuote = await this.getUniswapQuote(token0, token1, optimalSize, pair.fee);
      const aeroQuote = await this.getAerodromeQuote(token0, token1, optimalSize);
      
      if (!uniQuote.success || !aeroQuote.success) {
        console.error(chalk.red('❌ Failed to get quotes for execution'));
        return;
      }
      
      let swapDataA, swapDataB;
      
      if (uniQuote.amountOut < aeroQuote.amountOut) {
        console.log(chalk.cyan('  Strategy: Buy on Uniswap → Sell on Aerodrome'));
        swapDataA = this.encodeUniswapSwap(token0, token1, amountBorrow, 0, pair.fee);
        const amountOutUni = this.parseAmount(uniQuote.amountOut, token1.decimals);
        swapDataB = this.encodeAerodromeSwap(token1, token0, amountOutUni, 0);
      } else {
        console.log(chalk.cyan('  Strategy: Buy on Aerodrome → Sell on Uniswap'));
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

      console.log(chalk.cyan(`  📤 Sending flashloan transaction...`));
      const tx = await this.arbitrageContract.initiateFlashloan(tradeParams);
      console.log(chalk.green(`🛡️  Private Transaction Sent: ${tx.hash}`));
      
      const receipt = await tx.wait();
      console.log(chalk.green(`✅ Confirmed! Block: ${receipt.blockNumber}, Gas Used: ${receipt.gasUsed}`));
    } catch (error) {
      console.error(chalk.red('❌ Execution Error:'), error.message);
      if (error.code === 'INSUFFICIENT_FUNDS') {
        console.error(chalk.red('  ❗ Insufficient funds for gas'));
      }
    }
  }

  async checkPair(pair) {
    try {
      console.log(chalk.gray(`\n🔍 Scanning ${pair.name || `${pair.token0}/${pair.token1}`}...`));
      const { bestSize, maxNetProfit } = await this.findOptimalSize(pair);
      
      if (maxNetProfit > config.settings.executionThreshold) {
        console.log(chalk.green.bold(`🎯 ARBITRAGE OPPORTUNITY FOUND!`));
        console.log(chalk.green(`  Pair: ${pair.name || `${pair.token0}/${pair.token1}`}`));
        console.log(chalk.green(`  Optimal Size: $${bestSize.toFixed(2)}`));
        console.log(chalk.green(`  Estimated Profit: $${maxNetProfit.toFixed(2)}`));
        
        await this.executeArbitrage(pair, bestSize, maxNetProfit);
      } else if (maxNetProfit > 0) {
        console.log(chalk.gray(`  Small profit: $${maxNetProfit.toFixed(2)} (below threshold)`));
      } else {
        console.log(chalk.gray(`  No profitable opportunity`));
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error scanning pair ${pair.name || `${pair.token0}/${pair.token1}`}:`), error.message);
    }
  }

  async monitor() {
    console.log(chalk.blue.bold('\n🤖 Base Arbitrage Bot: MEV PROTECTION ACTIVE'));
    console.log(chalk.blue(`Mode: ${this.wallet ? 'TRADING' : 'READ-ONLY MONITORING'}`));
    console.log(chalk.blue(`Scanning ${config.pairs.length} pairs every ${config.settings.scanInterval / 1000}s`));
    
    this.isRunning = true;
    let cycle = 1;
    
    while (this.isRunning) {
      console.log(chalk.magenta(`\n═══════════════════════════════════════════════════`));
      console.log(chalk.magenta.bold(`🔁 Scan Cycle #${cycle}`));
      console.log(chalk.magenta.bold(`⏰ ${new Date().toLocaleTimeString()}`));
      
      await Promise.all(config.pairs.map(pair => this.checkPair(pair)));
      
      console.log(chalk.magenta(`\n⏳ Next scan in ${config.settings.scanInterval / 1000} seconds...`));
      await new Promise(r => setTimeout(r, config.settings.scanInterval));
      cycle++;
    }
  }

  async start() {
    try {
      const network = await this.provider.getNetwork();
      console.log(chalk.green(`✅ Connected to Base Network (Chain ID: ${network.chainId})`));
      
      // FIXED: Use provider.getBalance instead of wallet.getBalance
      if (this.wallet) {
        const balance = await this.executionProvider.getBalance(this.wallet.address);
        console.log(chalk.green(`💰 Wallet Balance: ${ethers.formatEther(balance)} ETH`));
      }
    } catch (error) {
      console.error(chalk.red('❌ Connection Failed:'), error.message);
      process.exit(1);
    }
    await this.monitor();
  }
}

module.exports = ArbitrageBot;
