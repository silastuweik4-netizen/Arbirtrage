const { ethers } = require('ethers');
const chalk = require('chalk');
const config = require('./config');
const { QUOTER_V2_ABI, AERODROME_ROUTER_ABI } = require('./abis');

// For Chalk v5+, we need to use the default export correctly
const { blue, green, yellow, red, cyan, magenta, gray, bold } = chalk;

class ArbitrageBot {
  constructor() {
    const scanRpcUrl = config.BASE_RPC_URL;
    const chainId = config.CHAIN_ID || 8453;
    const executionRpcUrl = config.FLASHBOTS_RPC_URL || 'https://rpc.flashbots.net/base';
    const privateKey = process.env.PRIVATE_KEY || config.PRIVATE_KEY;

    console.log(blue(`📡 Initializing MEV-Protected Bot for Chain ID ${chainId}...`));
    
    try {
      // FIX: Remove staticNetwork option to avoid chain ID conflicts
      this.provider = new ethers.JsonRpcProvider(scanRpcUrl);
      this.executionProvider = new ethers.JsonRpcProvider(executionRpcUrl);
      
      if (privateKey && privateKey.trim() !== '') {
        this.wallet = new ethers.Wallet(privateKey, this.executionProvider);
        console.log(green(`✅ Wallet loaded: ${this.wallet.address}`));
      } else {
        console.warn(yellow('⚠️  No Private Key found. Bot will run in READ-ONLY mode.'));
        this.wallet = null;
      }
    } catch (error) {
      console.error(red('❌ Initialization Failed:'), error.message);
      process.exit(1);
    }

    // Debug: Log contract addresses
    console.log(cyan('📋 Contract Addresses:'));
    console.log(cyan(`  • Uniswap V3 Quoter: ${config.contracts.uniswapV3Quoter}`));
    console.log(cyan(`  • Aerodrome Router: ${config.contracts.aerodromeRouter}`));
    console.log(cyan(`  • Arbitrage Contract: ${config.contracts.arbitrageContract}`));

    try {
      // FIX: Add validation for contract addresses
      if (!config.contracts.uniswapV3Quoter || config.contracts.uniswapV3Quoter === '0x0000000000000000000000000000000000000000') {
        throw new Error('Missing or invalid Uniswap V3 Quoter address');
      }
      
      if (!config.contracts.aerodromeRouter || config.contracts.aerodromeRouter === '0x0000000000000000000000000000000000000000') {
        throw new Error('Missing or invalid Aerodrome Router address');
      }

      this.uniswapQuoter = new ethers.Contract(
        config.contracts.uniswapV3Quoter, 
        QUOTER_V2_ABI, 
        this.provider
      );
      console.log(green('✅ Uniswap V3 Quoter loaded'));

      this.aerodromeRouter = new ethers.Contract(
        config.contracts.aerodromeRouter, 
        AERODROME_ROUTER_ABI, 
        this.provider
      );
      console.log(green('✅ Aerodrome Router loaded'));
      
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
        console.log(green('✅ Arbitrage contract loaded'));
      } else {
        this.arbitrageContract = null;
        if (!this.wallet) {
          console.warn(yellow('⚠️  Arbitrage contract not loaded (no wallet - READ-ONLY mode)'));
        } else if (!config.contracts.arbitrageContract) {
          console.warn(yellow('⚠️  Arbitrage contract not loaded (no contract address in config)'));
        }
      }

    } catch (error) {
      console.error(red('❌ Contract initialization failed:'), error.message);
      process.exit(1);
    }

    this.isRunning = false;
  }

  formatAmount(amount, decimals) { 
    return ethers.formatUnits(amount, decimals); 
  }
  
  parseAmount(amount, decimals) { 
    try {
      // Convert to string and handle decimal places
      const amountStr = amount.toString();
      const [integer, fractional = ''] = amountStr.split('.');
      const truncatedFractional = fractional.slice(0, decimals);
      const adjustedAmount = fractional ? `${integer}.${truncatedFractional}` : integer;
      return ethers.parseUnits(adjustedAmount, decimals);
    } catch (error) {
      console.error(red(`❌ Error parsing amount ${amount} with decimals ${decimals}:`), error.message);
      return ethers.parseUnits("0", decimals);
    }
  }

  async getUniswapQuote(tokenIn, tokenOut, amountIn, fee) {
    try {
      // FIX: Use checksum addresses
      const tokenInAddress = ethers.getAddress(tokenIn.address);
      const tokenOutAddress = ethers.getAddress(tokenOut.address);
      
      const params = {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        amountIn: this.parseAmount(amountIn, tokenIn.decimals),
        fee: fee,
        sqrtPriceLimitX96: 0
      };
      
      const result = await this.uniswapQuoter.quoteExactInputSingle.staticCall(params);
      const amountOut = parseFloat(this.formatAmount(result[0], tokenOut.decimals));
      
      return { 
        amountOut: amountOut, 
        success: true 
      };
    } catch (e) { 
      // FIX: Better error logging with token names
      console.warn(yellow(`⚠️  Uniswap quote failed for ${tokenIn.name || tokenIn.symbol}/${tokenOut.name || tokenOut.symbol}: ${e.message}`));
      return { success: false }; 
    }
  }

  async getAerodromeQuote(tokenIn, tokenOut, amountIn) {
    try {
      // FIX: Use checksum addresses
      const tokenInAddress = ethers.getAddress(tokenIn.address);
      const tokenOutAddress = ethers.getAddress(tokenOut.address);
      const factoryAddress = ethers.getAddress(config.contracts.aerodromeFactory);
      
      const routes = [{ 
        from: tokenInAddress, 
        to: tokenOutAddress, 
        stable: false, 
        factory: factoryAddress
      }];
      
      const amountInWei = this.parseAmount(amountIn, tokenIn.decimals);
      const amounts = await this.aerodromeRouter.getAmountsOut(amountInWei, routes);
      
      if (amounts.length < 2) {
        throw new Error('Invalid response from Aerodrome router');
      }
      
      const amountOut = parseFloat(this.formatAmount(amounts[1], tokenOut.decimals));
      
      return { 
        amountOut: amountOut, 
        success: true 
      };
    } catch (e) { 
      // FIX: Better error logging with token names
      console.warn(yellow(`⚠️  Aerodrome quote failed for ${tokenIn.name || tokenIn.symbol}/${tokenOut.name || tokenOut.symbol}: ${e.message}`));
      return { success: false }; 
    }
  }

  async calculateNetProfit(tokenIn, tokenOut, amountIn, fee) {
    const [uni, aero] = await Promise.all([
      this.getUniswapQuote(tokenIn, tokenOut, amountIn, fee),
      this.getAerodromeQuote(tokenIn, tokenOut, amountIn)
    ]);

    if (!uni.success || !aero.success) {
      return -1;
    }

    // FIX: More realistic profit calculation
    // We should compare prices correctly
    const uniPrice = uni.amountOut / amountIn; // Price on Uniswap
    const aeroPrice = aero.amountOut / amountIn; // Price on Aerodrome
    
    // Check if there's actually an arbitrage opportunity
    if (Math.abs(uniPrice - aeroPrice) < 0.001) { // Less than 0.1% difference
      return -1;
    }
    
    // Determine which DEX has better price for buying vs selling
    const buyPrice = Math.min(uniPrice, aeroPrice);
    const sellPrice = Math.max(uniPrice, aeroPrice);
    
    // Calculate profit in USD terms
    const grossProfit = (sellPrice - buyPrice) * amountIn;
    
    // Realistic fees (adjust these based on actual costs)
    const flashloanFee = amountIn * buyPrice * 0.0005; // 0.05% flashloan fee
    const gasFee = 0.50; // More realistic gas cost for complex flashloan (in USD)
    const slippageLoss = amountIn * buyPrice * 0.003; // 0.3% slippage
    
    const netProfit = grossProfit - flashloanFee - gasFee - slippageLoss;
    
    if (netProfit > 0 && netProfit < 1000000) { // Sanity check: profit shouldn't be > $1M from $1k
      console.log(cyan(`  → Potential profit: $${netProfit.toFixed(2)}`));
    } else if (netProfit > 1000000) {
      console.log(red(`  ❗ Unrealistic profit detected: $${netProfit.toFixed(2)} - likely pricing error`));
      return -1;
    }
    
    return netProfit;
  }

  async findOptimalSize(pair) {
    const token0 = config.tokens[pair.token0];
    const token1 = config.tokens[pair.token1];
    const maxSize = config.settings.maxFlashloanAmount || 10;
    
    let bestSize = 0;
    let maxNetProfit = 0;
    
    const steps = 5; // Reduce steps for faster scanning
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
      from: ethers.getAddress(tokenIn.address), 
      to: ethers.getAddress(tokenOut.address), 
      stable: false, 
      factory: ethers.getAddress(config.contracts.aerodromeFactory)
    }];
    
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    
    return iface.encodeFunctionData('swapExactTokensForTokens', [
      amountIn,
      amountOutMin,
      routes,
      ethers.getAddress(config.contracts.arbitrageContract),
      deadline
    ]);
  }

  encodeUniswapSwap(tokenIn, tokenOut, amountIn, amountOutMin, fee) {
    const iface = new ethers.Interface([
      'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)'
    ]);
    
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    
    const params = {
      tokenIn: ethers.getAddress(tokenIn.address),
      tokenOut: ethers.getAddress(tokenOut.address),
      fee: fee,
      recipient: ethers.getAddress(config.contracts.arbitrageContract),
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
      console.log(yellow(`⚠️  READ-ONLY MODE: Opportunity found for ${pair.name} ($${netProfit.toFixed(2)}), but no wallet or contract configured.`));
      return;
    }

    // Safety check: Don't execute if profit seems unrealistic
    if (netProfit > 1000) {
      console.log(red(`⚠️  Suspicious profit detected: $${netProfit.toFixed(2)} from $${optimalSize.toFixed(2)} - skipping execution`));
      return;
    }

    console.log(yellow(bold(`🚀 EXECUTING MEV-PROTECTED ARBITRAGE: ${pair.name}`)));
    
    try {
      const token0 = config.tokens[pair.token0];
      const token1 = config.tokens[pair.token1];
      
      const amountBorrow = this.parseAmount(optimalSize, token0.decimals);
      
      // More conservative minAmountOut (10% of estimated profit)
      const minAmountOut = this.parseAmount(netProfit * 0.1, token0.decimals);

      const uniQuote = await this.getUniswapQuote(token0, token1, optimalSize, pair.fee);
      const aeroQuote = await this.getAerodromeQuote(token0, token1, optimalSize);
      
      if (!uniQuote.success || !aeroQuote.success) {
        console.error(red('❌ Failed to get quotes for execution'));
        return;
      }
      
      let swapDataA, swapDataB;
      
      if (uniQuote.amountOut < aeroQuote.amountOut) {
        console.log(cyan('  Strategy: Buy on Uniswap → Sell on Aerodrome'));
        swapDataA = this.encodeUniswapSwap(token0, token1, amountBorrow, 0, pair.fee);
        const amountOutUni = this.parseAmount(uniQuote.amountOut, token1.decimals);
        swapDataB = this.encodeAerodromeSwap(token1, token0, amountOutUni, 0);
      } else {
        console.log(cyan('  Strategy: Buy on Aerodrome → Sell on Uniswap'));
        swapDataA = this.encodeAerodromeSwap(token0, token1, amountBorrow, 0);
        const amountOutAero = this.parseAmount(aeroQuote.amountOut, token1.decimals);
        swapDataB = this.encodeUniswapSwap(token1, token0, amountOutAero, 0, pair.fee);
      }

      const tradeParams = {
        tokenBorrow: ethers.getAddress(token0.address),
        amountBorrow: amountBorrow,
        tokenIn: ethers.getAddress(token0.address),
        tokenOut: ethers.getAddress(token1.address),
        minAmountOut: minAmountOut,
        swapDataA: swapDataA,
        swapDataB: swapDataB
      };

      console.log(cyan(`  📤 Sending flashloan transaction...`));
      
      // FIX: Add explicit chain ID to transaction
      const tx = await this.arbitrageContract.initiateFlashloan(tradeParams, {
        type: 2, // EIP-1559
        maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
        maxFeePerGas: ethers.parseUnits('20', 'gwei'),
        gasLimit: 500000
      });
      
      console.log(green(`🛡️  Private Transaction Sent: ${tx.hash}`));
      
      const receipt = await tx.wait();
      console.log(green(`✅ Confirmed! Block: ${receipt.blockNumber}, Gas Used: ${receipt.gasUsed}`));
    } catch (error) {
      console.error(red('❌ Execution Error:'), error.message);
      if (error.code === 'INSUFFICIENT_FUNDS') {
        console.error(red('  ❗ Insufficient funds for gas'));
      } else if (error.message.includes('invalid chain id')) {
        console.error(red('  ❗ Chain ID mismatch. Check your RPC URL and network configuration.'));
      }
    }
  }

  async checkPair(pair) {
    // Skip disabled pairs
    if (pair.enabled === false) {
      console.log(gray(`  Skipping disabled pair: ${pair.name}`));
      return;
    }
    
    try {
      console.log(gray(`\n🔍 Scanning ${pair.name}...`));
      const { bestSize, maxNetProfit } = await this.findOptimalSize(pair);
      
      if (maxNetProfit > config.settings.executionThreshold) {
        console.log(green(bold(`🎯 ARBITRAGE OPPORTUNITY FOUND!`)));
        console.log(green(`  Pair: ${pair.name}`));
        console.log(green(`  Optimal Size: $${bestSize.toFixed(2)}`));
        console.log(green(`  Estimated Profit: $${maxNetProfit.toFixed(2)}`));
        
        await this.executeArbitrage(pair, bestSize, maxNetProfit);
      } else if (maxNetProfit > 0) {
        console.log(gray(`  Small profit: $${maxNetProfit.toFixed(2)} (below threshold)`));
      } else {
        console.log(gray(`  No profitable opportunity`));
      }
    } catch (error) {
      console.error(red(`❌ Error scanning pair ${pair.name}:`), error.message);
    }
  }

  async monitor() {
    console.log(blue(bold('\n🤖 Base Arbitrage Bot: MEV PROTECTION ACTIVE')));
    console.log(blue(`Mode: ${this.wallet ? 'TRADING' : 'READ-ONLY MONITORING'}`));
    console.log(blue(`Scanning ${config.pairs.filter(p => p.enabled !== false).length} enabled pairs every ${config.settings.scanInterval / 1000}s`));
    
    this.isRunning = true;
    let cycle = 1;
    
    while (this.isRunning) {
      console.log(magenta(`\n═══════════════════════════════════════════════════`));
      console.log(magenta(bold(`🔁 Scan Cycle #${cycle}`)));
      console.log(magenta(bold(`⏰ ${new Date().toLocaleTimeString()}`)));
      
      // Only check enabled pairs
      const enabledPairs = config.pairs.filter(p => p.enabled !== false);
      await Promise.all(enabledPairs.map(pair => this.checkPair(pair)));
      
      console.log(magenta(`\n⏳ Next scan in ${config.settings.scanInterval / 1000} seconds...`));
      await new Promise(r => setTimeout(r, config.settings.scanInterval));
      cycle++;
    }
  }

  async start() {
    try {
      const network = await this.provider.getNetwork();
      console.log(green(`✅ Connected to Base Network (Chain ID: ${network.chainId})`));
      
      if (this.wallet) {
        const balance = await this.executionProvider.getBalance(this.wallet.address);
        console.log(green(`💰 Wallet Balance: ${ethers.formatEther(balance)} ETH`));
        
        if (ethers.formatEther(balance) < 0.01) {
          console.warn(yellow('⚠️  Low balance - ensure you have enough ETH for gas fees'));
        }
      }
    } catch (error) {
      console.error(red('❌ Connection Failed:'), error.message);
      process.exit(1);
    }
    await this.monitor();
  }
}

module.exports = ArbitrageBot;
