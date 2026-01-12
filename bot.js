const { ethers } = require('ethers');
const config = require('./config');
const { QUOTER_V2_ABI, AERODROME_ROUTER_ABI } = require('./abis');

// Simple color codes for console
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

const bold = '\x1b[1m';

class ArbitrageBot {
  constructor() {
    const scanRpcUrl = config.BASE_RPC_URL;
    const chainId = config.CHAIN_ID || 8453;
    const executionRpcUrl = config.FLASHBOTS_RPC_URL || 'https://rpc.flashbots.net/base';
    const privateKey = process.env.PRIVATE_KEY || config.PRIVATE_KEY;

    console.log(colors.blue + '📡 Initializing MEV-Protected Bot for Chain ID ' + chainId + '...' + colors.reset);
    
    try {
      // FIX: Remove staticNetwork option to avoid chain ID conflicts
      this.provider = new ethers.JsonRpcProvider(scanRpcUrl);
      this.executionProvider = new ethers.JsonRpcProvider(executionRpcUrl);
      
      if (privateKey && privateKey.trim() !== '') {
        this.wallet = new ethers.Wallet(privateKey, this.executionProvider);
        console.log(colors.green + '✅ Wallet loaded: ' + this.wallet.address + colors.reset);
      } else {
        console.log(colors.yellow + '⚠️  No Private Key found. Bot will run in READ-ONLY mode.' + colors.reset);
        this.wallet = null;
      }
    } catch (error) {
      console.error(colors.red + '❌ Initialization Failed:' + colors.reset, error.message);
      process.exit(1);
    }

    // Debug: Log contract addresses
    console.log(colors.cyan + '📋 Contract Addresses:' + colors.reset);
    console.log(colors.cyan + '  • Uniswap V3 Quoter: ' + config.contracts.uniswapV3Quoter + colors.reset);
    console.log(colors.cyan + '  • Aerodrome Router: ' + config.contracts.aerodromeRouter + colors.reset);
    console.log(colors.cyan + '  • Arbitrage Contract: ' + config.contracts.arbitrageContract + colors.reset);

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
      console.log(colors.green + '✅ Uniswap V3 Quoter loaded' + colors.reset);

      this.aerodromeRouter = new ethers.Contract(
        config.contracts.aerodromeRouter, 
        AERODROME_ROUTER_ABI, 
        this.provider
      );
      console.log(colors.green + '✅ Aerodrome Router loaded' + colors.reset);
      
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
        console.log(colors.green + '✅ Arbitrage contract loaded' + colors.reset);
      } else {
        this.arbitrageContract = null;
        if (!this.wallet) {
          console.log(colors.yellow + '⚠️  Arbitrage contract not loaded (no wallet - READ-ONLY mode)' + colors.reset);
        } else if (!config.contracts.arbitrageContract) {
          console.log(colors.yellow + '⚠️  Arbitrage contract not loaded (no contract address in config)' + colors.reset);
        }
      }

    } catch (error) {
      console.error(colors.red + '❌ Contract initialization failed:' + colors.reset, error.message);
      process.exit(1);
    }

    this.isRunning = false;
    // Add circuit breaker to prevent excessive failed transactions
    this.failureCount = 0;
    this.maxFailures = 5;
    this.circuitBreakerTimeout = 60000; // 1 minute
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
      console.error(colors.red + '❌ Error parsing amount ' + amount + ' with decimals ' + decimals + ':' + colors.reset, error.message);
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
      console.log(colors.yellow + '⚠️  Uniswap quote failed for ' + (tokenIn.name || tokenIn.symbol) + '/' + (tokenOut.name || tokenOut.symbol) + ': ' + e.message + colors.reset);
      return { success: false }; 
    }
  }

  async getAerodromeQuote(tokenIn, tokenOut, amountIn, pair) {
    try {
      // FIX: Use checksum addresses
      const tokenInAddress = ethers.getAddress(tokenIn.address);
      const tokenOutAddress = ethers.getAddress(tokenOut.address);
      const factoryAddress = ethers.getAddress(config.contracts.aerodromeFactory);
      
      const routes = [{ 
        from: tokenInAddress, 
        to: tokenOutAddress, 
        stable: pair.stable, // Use stable flag from config
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
      console.log(colors.yellow + '⚠️  Aerodrome quote failed for ' + (tokenIn.name || tokenIn.symbol) + '/' + (tokenOut.name || tokenOut.symbol) + ': ' + e.message + colors.reset);
      return { success: false }; 
    }
  }

  async calculateNetProfit(tokenIn, tokenOut, amountIn, fee, pair) {
    try {
      const [uni, aero] = await Promise.all([
        this.getUniswapQuote(tokenIn, tokenOut, amountIn, fee),
        this.getAerodromeQuote(tokenIn, tokenOut, amountIn, pair) // Pass pair object
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
      
      // Use values from config.js
      const flashloanFee = amountIn * buyPrice * (config.settings.flashloanFeePercent / 100);
      const gasFee = config.settings.estimatedGasCostUSD;
      const slippageLoss = amountIn * buyPrice * (config.settings.slippageTolerancePercent / 100);
      
      const netProfit = grossProfit - flashloanFee - gasFee - slippageLoss;
      
      if (netProfit > 0 && netProfit < 1000000) { // Sanity check: profit shouldn't be > $1M from $1k
        console.log(colors.cyan + '  → Potential profit: $' + netProfit.toFixed(2) + colors.reset);
      } else if (netProfit > 1000000) {
        console.log(colors.red + '  ❗ Unrealistic profit detected: $' + netProfit.toFixed(2) + ' - likely pricing error' + colors.reset);
        return -1;
      }
      
      return netProfit;
    } catch (error) {
      console.error(colors.red + '❌ Error calculating net profit:' + colors.reset, error.message);
      return -1;
    }
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
      // Pass pair object to calculateNetProfit
      const netProfit = await this.calculateNetProfit(token0, token1, testSize, pair.fee, pair);
      
      if (netProfit > maxNetProfit) {
        maxNetProfit = netProfit;
        bestSize = testSize;
      }
    }
    
    return { bestSize, maxNetProfit };
  }

  encodeAerodromeSwap(tokenIn, tokenOut, amountIn, amountOutMin, pair) {
    const iface = new ethers.Interface([
      'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) external returns (uint256[])'
    ]);
    
    const routes = [{ 
      from: ethers.getAddress(tokenIn.address), 
      to: ethers.getAddress(tokenOut.address), 
      stable: pair.stable, // Use stable flag from config
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

  async checkContractExists(address) {
    try {
      const code = await this.provider.getCode(address);
      return code !== '0x';
    } catch (error) {
      console.error(colors.red + '❌ Error checking contract existence for ' + address + ':' + colors.reset, error.message);
      return false;
    }
  }

  async executeArbitrage(pair, optimalSize, netProfit) {
    // Check if we can execute (have wallet and contract)
    if (!this.wallet || !this.arbitrageContract) {
      console.log(colors.yellow + '⚠️  READ-ONLY MODE: Opportunity found for ' + pair.name + ' ($' + netProfit.toFixed(2) + '), but no wallet or contract configured.' + colors.reset);
      return;
    }

    // Check circuit breaker
    if (this.failureCount >= this.maxFailures) {
      console.log(colors.red + '⚠️  CIRCUIT BREAKER ACTIVE: Too many failures. Waiting ' + (this.circuitBreakerTimeout / 1000) + ' seconds before retrying.' + colors.reset);
      setTimeout(() => {
        this.failureCount = 0;
        console.log(colors.green + '✅ Circuit breaker reset. Resuming operations.' + colors.reset);
      }, this.circuitBreakerTimeout);
      return;
    }

    // Safety check: Don't execute if profit seems unrealistic
    if (netProfit > 1000) {
      console.log(colors.red + '⚠️  Suspicious profit detected: $' + netProfit.toFixed(2) + ' from $' + optimalSize.toFixed(2) + ' - skipping execution' + colors.reset);
      return;
    }

    console.log(colors.yellow + bold + '🚀 EXECUTING MEV-PROTECTED ARBITRAGE: ' + pair.name + colors.reset); // FIX: reset -> colors.reset
    
    try {
      const token0 = config.tokens[pair.token0];
      const token1 = config.tokens[pair.token1];
      
      // Verify contracts exist before proceeding
      const arbitrageContractExists = await this.checkContractExists(config.contracts.arbitrageContract);
      if (!arbitrageContractExists) {
        throw new Error('Arbitrage contract does not exist at the specified address');
      }
      
      const amountBorrow = this.parseAmount(optimalSize, token0.decimals);
      
      // More conservative minAmountOut (10% of estimated profit)
      const minAmountOut = this.parseAmount(netProfit * 0.1, token0.decimals);

      const uniQuote = await this.getUniswapQuote(token0, token1, optimalSize, pair.fee);
      const aeroQuote = await this.getAerodromeQuote(token0, token1, optimalSize, pair);
      
      if (!uniQuote.success || !aeroQuote.success) {
        throw new Error('Failed to get quotes for execution');
      }
      
      let swapDataA, swapDataB;
      
      if (uniQuote.amountOut < aeroQuote.amountOut) {
        console.log(colors.cyan + '  Strategy: Buy on Uniswap → Sell on Aerodrome' + colors.reset);
        swapDataA = this.encodeUniswapSwap(token0, token1, amountBorrow, 0, pair.fee);
        const amountOutUni = this.parseAmount(uniQuote.amountOut, token1.decimals);
        swapDataB = this.encodeAerodromeSwap(token1, token0, amountOutUni, 0, pair);
      } else {
        console.log(colors.cyan + '  Strategy: Buy on Aerodrome → Sell on Uniswap' + colors.reset);
        swapDataA = this.encodeAerodromeSwap(token0, token1, amountBorrow, 0, pair);
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

      console.log(colors.cyan + '  📤 Sending flashloan transaction...' + colors.reset);
      
      // Get current gas price
      const feeData = await this.executionProvider.getFeeData();
      
      // FIX: Add explicit chain ID to transaction
      const tx = await this.arbitrageContract.initiateFlashloan(tradeParams, {
        type: 2, // EIP-1559
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('2', 'gwei'),
        maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits('20', 'gwei'),
        gasLimit: 500000
      });
      
      console.log(colors.green + '🛡️  Private Transaction Sent: ' + tx.hash + colors.reset);
      
      const receipt = await tx.wait();
      console.log(colors.green + '✅ Confirmed! Block: ' + receipt.blockNumber + ', Gas Used: ' + receipt.gasUsed + colors.reset);
      
      // Reset failure count on success
      this.failureCount = 0;
    } catch (error) {
      console.error(colors.red + '❌ Execution Error:' + colors.reset, error.message);
      this.failureCount++;
      
      if (error.code === 'INSUFFICIENT_FUNDS') {
        console.error(colors.red + '  ❗ Insufficient funds for gas' + colors.reset);
      } else if (error.message.includes('invalid chain id')) {
        console.error(colors.red + '  ❗ Chain ID mismatch. Check your RPC URL and network configuration.' + colors.reset);
      } else if (error.message.includes('Arbitrage contract does not exist')) {
        console.error(colors.red + '  ❗ Contract verification failed. Check contract address.' + colors.reset);
      }
      
      // If we've hit the failure threshold, activate circuit breaker
      if (this.failureCount >= this.maxFailures) {
        console.log(colors.red + '⚠️  ACTIVATING CIRCUIT BREAKER: ' + this.failureCount + ' consecutive failures.' + colors.reset);
      }
    }
  }

  async checkPair(pair) {
    // Skip disabled pairs
    if (pair.enabled === false) {
      console.log(colors.gray + '  Skipping disabled pair: ' + pair.name + colors.reset);
      return;
    }
    
    try {
      console.log(colors.gray + '\n🔍 Scanning ' + pair.name + '...' + colors.reset);
      const { bestSize, maxNetProfit } = await this.findOptimalSize(pair);
      
      if (maxNetProfit > config.settings.executionThreshold) {
        console.log(colors.green + bold + '🎯 ARBITRAGE OPPORTUNITY FOUND!' + colors.reset); // FIX: reset -> colors.reset
        console.log(colors.green + '  Pair: ' + pair.name + colors.reset);
        console.log(colors.green + '  Optimal Size: $' + bestSize.toFixed(2) + colors.reset);
        console.log(colors.green + '  Estimated Profit: $' + maxNetProfit.toFixed(2) + colors.reset);
        
        await this.executeArbitrage(pair, bestSize, maxNetProfit);
      } else if (maxNetProfit > 0) {
        console.log(colors.gray + '  Small profit: $' + maxNetProfit.toFixed(2) + ' (below threshold)' + colors.reset);
      } else {
        console.log(colors.gray + '  No profitable opportunity' + colors.reset);
      }
    } catch (error) {
      console.error(colors.red + '❌ Error scanning pair ' + pair.name + ':' + colors.reset, error.message);
    }
  }

  async monitor() {
    console.log(colors.blue + bold + '\n🤖 Base Arbitrage Bot: MEV PROTECTION ACTIVE' + colors.reset); // FIX: reset -> colors.reset
    console.log(colors.blue + 'Mode: ' + (this.wallet ? 'TRADING' : 'READ-ONLY MONITORING') + colors.reset);
    console.log(colors.blue + 'Scanning ' + config.pairs.filter(p => p.enabled !== false).length + ' enabled pairs every ' + (config.settings.scanInterval / 1000) + 's' + colors.reset);
    
    this.isRunning = true;
    let cycle = 1;
    
    while (this.isRunning) {
      console.log(colors.magenta + '\n═══════════════════════════════════════════════════' + colors.reset);
      console.log(colors.magenta + bold + '🔁 Scan Cycle #' + cycle + colors.reset); // FIX: reset -> colors.reset
      console.log(colors.magenta + bold + '⏰ ' + new Date().toLocaleTimeString() + colors.reset); // FIX: reset -> colors.reset
      
      // Only check enabled pairs
      const enabledPairs = config.pairs.filter(p => p.enabled !== false);
      await Promise.all(enabledPairs.map(pair => this.checkPair(pair)));
      
      console.log(colors.magenta + '\n⏳ Next scan in ' + (config.settings.scanInterval / 1000) + ' seconds...' + colors.reset);
      await new Promise(r => setTimeout(r, config.settings.scanInterval));
      cycle++;
    }
  }

  async start() {
    try {
      const network = await this.provider.getNetwork();
      console.log(colors.green + '✅ Connected to Base Network (Chain ID: ' + network.chainId + ')' + colors.reset);
      
      if (this.wallet) {
        const balance = await this.executionProvider.getBalance(this.wallet.address);
        console.log(colors.green + '💰 Wallet Balance: ' + ethers.formatEther(balance) + ' ETH' + colors.reset);
        
        if (parseFloat(ethers.formatEther(balance)) < 0.01) {
          console.log(colors.yellow + '⚠️  Low balance - ensure you have enough ETH for gas fees' + colors.reset);
        }
      }
    } catch (error) {
      console.error(colors.red + '❌ Connection Failed:' + colors.reset, error.message);
      process.exit(1);
    }
    await this.monitor();
  }
}

module.exports = ArbitrageBot;
