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

    console.log(colors.blue + '📡 Initializing Enhanced MEV-Protected Bot for Chain ID ' + chainId + '...' + colors.reset);
    
    try {
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
      // Validate contract addresses
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
    
    // NEW: Enhanced features
    this.gasPriceHistory = [];
    this.profitHistory = {};
    this.lastBlockNumber = 0;
    this.pendingTransactions = new Map();
    this.mempoolActivity = {
      high: 0,
      medium: 0,
      low: 0
    };
    
    // NEW: Performance metrics
    this.metrics = {
      totalScans: 0,
      opportunitiesFound: 0,
      successfulArbitrages: 0,
      failedArbitrages: 0,
      totalProfit: 0,
      averageGasUsed: 0,
      scanTime: []
    };
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

  // NEW: Dynamic gas price optimization
  async optimizeGasPrice() {
    try {
      const feeData = await this.executionProvider.getFeeData();
      
      // Store gas price history for trend analysis
      this.gasPriceHistory.push({
        timestamp: Date.now(),
        gasPrice: feeData.gasPrice,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
      });
      
      // Keep only last 50 entries
      if (this.gasPriceHistory.length > 50) {
        this.gasPriceHistory.shift();
      }
      
      // Calculate average gas price from recent history
      const recentHistory = this.gasPriceHistory.slice(-10);
      const avgMaxPriorityFee = recentHistory.reduce((sum, entry) => 
        sum + Number(entry.maxPriorityFeePerGas || 0), 0) / recentHistory.length;
      
      // Adjust gas price based on network congestion
      let multiplier = 1.0;
      if (this.mempoolActivity.high > 5) {
        multiplier = 1.2; // Increase gas price during high activity
      } else if (this.mempoolActivity.low > 10) {
        multiplier = 0.9; // Decrease gas price during low activity
      }
      
      return {
        maxFeePerGas: (feeData.maxFeePerGas || ethers.parseUnits('20', 'gwei')) * BigInt(Math.floor(multiplier * 100)) / 100n,
        maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas || ethers.parseUnits('2', 'gwei')) * BigInt(Math.floor(multiplier * 100)) / 100n
      };
    } catch (error) {
      console.error(colors.red + '❌ Error optimizing gas price:' + colors.reset, error.message);
      // Return default values if optimization fails
      return {
        maxFeePerGas: ethers.parseUnits('20', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei')
      };
    }
  }

  // NEW: Dynamic slippage calculation based on market conditions
  calculateDynamicSlippage(pair, amount) {
    // Base slippage from config
    let baseSlippage = config.settings.slippageTolerancePercent / 100;
    
    // Adjust based on token volatility (if we have historical data)
    if (this.profitHistory[pair.name] && this.profitHistory[pair.name].length > 5) {
      const recentProfits = this.profitHistory[pair.name].slice(-5);
      const volatility = this.calculateVolatility(recentProfits);
      
      // Increase slippage for more volatile pairs
      if (volatility > 0.1) {
        baseSlippage *= 1.5;
      }
    }
    
    // Adjust based on trade size (larger trades need more slippage)
    const sizeMultiplier = Math.min(1.0 + (amount / 10000), 2.0); // Max 2x slippage for very large trades
    
    return baseSlippage * sizeMultiplier;
  }

  // NEW: Calculate volatility from profit history
  calculateVolatility(values) {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    
    return Math.sqrt(avgSquaredDiff);
  }

  // NEW: Monitor mempool for MEV competition
  async monitorMempool() {
    try {
      // Reset counters
      this.mempoolActivity = { high: 0, medium: 0, low: 0 };
      
      // Get pending transactions (simplified approach)
      const block = await this.provider.getBlock('pending');
      if (!block || !block.transactions) return;
      
      // Sample a subset of transactions to estimate activity
      const sampleSize = Math.min(block.transactions.length, 20);
      for (let i = 0; i < sampleSize; i++) {
        try {
          const tx = await this.provider.getTransaction(block.transactions[i]);
          if (!tx) continue;
          
          // Categorize by gas price
          const gasPrice = Number(tx.gasPrice || 0);
          const baseGasPrice = Number(ethers.parseUnits('1', 'gwei'));
          
          if (gasPrice > baseGasPrice * 5) {
            this.mempoolActivity.high++;
          } else if (gasPrice > baseGasPrice * 2) {
            this.mempoolActivity.medium++;
          } else {
            this.mempoolActivity.low++;
          }
        } catch (error) {
          // Skip transaction if we can't fetch it
        }
      }
    } catch (error) {
      // Silently fail to avoid disrupting main bot logic
    }
  }

  // ENHANCED: Improved quote function with retry logic
  async getUniswapQuote(tokenIn, tokenOut, amountIn, fee, retries = 2) {
    try {
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
      if (retries > 0) {
        // Wait a bit and retry
        await new Promise(resolve => setTimeout(resolve, 100));
        return this.getUniswapQuote(tokenIn, tokenOut, amountIn, fee, retries - 1);
      }
      
      console.log(colors.yellow + '⚠️  Uniswap quote failed for ' + (tokenIn.name || tokenIn.symbol) + '/' + (tokenOut.name || tokenOut.symbol) + ': ' + e.message + colors.reset);
      return { success: false }; 
    }
  }

  // ENHANCED: Improved quote function with retry logic
  async getAerodromeQuote(tokenIn, tokenOut, amountIn, pair, retries = 2) {
    try {
      const tokenInAddress = ethers.getAddress(tokenIn.address);
      const tokenOutAddress = ethers.getAddress(tokenOut.address);
      const factoryAddress = ethers.getAddress(config.contracts.aerodromeFactory);
      
      const routes = [{ 
        from: tokenInAddress, 
        to: tokenOutAddress, 
        stable: pair.stable,
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
      if (retries > 0) {
        // Wait a bit and retry
        await new Promise(resolve => setTimeout(resolve, 100));
        return this.getAerodromeQuote(tokenIn, tokenOut, amountIn, pair, retries - 1);
      }
      
      console.log(colors.yellow + '⚠️  Aerodrome quote failed for ' + (tokenIn.name || tokenIn.symbol) + '/' + (tokenOut.name || tokenOut.symbol) + ': ' + e.message + colors.reset);
      return { success: false }; 
    }
  }

  // ENHANCED: More sophisticated profit calculation
  async calculateNetProfit(tokenIn, tokenOut, amountIn, fee, pair) {
    try {
      const [uni, aero] = await Promise.all([
        this.getUniswapQuote(tokenIn, tokenOut, amountIn, fee),
        this.getAerodromeQuote(tokenIn, tokenOut, amountIn, pair)
      ]);

      // If either quote fails, we can't calculate a profit.
      if (!uni.success || !aero.success) {
        return -1;
      }

      // Defensive check to prevent errors if amountOut is somehow 0 or invalid
      if (uni.amountOut <= 0 || aero.amountOut <= 0) {
        return -1;
      }

      const uniPrice = uni.amountOut / amountIn;
      const aeroPrice = aero.amountOut / amountIn;
      
      // Check if there's actually an arbitrage opportunity
      if (Math.abs(uniPrice - aeroPrice) < 0.001) { // Less than 0.1% difference
        return -1;
      }
      
      // Determine which DEX has better price for buying vs selling
      const buyPrice = Math.min(uniPrice, aeroPrice);
      const sellPrice = Math.max(uniPrice, aeroPrice);
      
      // Calculate profit in USD terms
      const grossProfit = (sellPrice - buyPrice) * amountIn;
      
      // NEW: Dynamic slippage calculation
      const dynamicSlippage = this.calculateDynamicSlippage(pair, amountIn);
      const slippageLoss = amountIn * buyPrice * dynamicSlippage;
      
      // Use values from config.js
      const flashloanFee = amountIn * buyPrice * (config.settings.flashloanFeePercent / 100);
      
      // NEW: More realistic gas estimation based on current network conditions
      const optimizedGas = await this.optimizeGasPrice();
      const estimatedGasCostWei = optimizedGas.maxFeePerGas * BigInt(config.settings.gasLimit);
      const ethPriceUSD = await this.getETHPriceUSD();
      const gasFee = parseFloat(ethers.formatEther(estimatedGasCostWei)) * ethPriceUSD;
      
      // NEW: MEV competition factor - reduce expected profit during high mempool activity
      const mevCompetitionFactor = 1.0 + (this.mempoolActivity.high * 0.05);
      
      const netProfit = (grossProfit - flashloanFee - gasFee - slippageLoss) / mevCompetitionFactor;
      
      // Store profit history for future analysis
      if (!this.profitHistory[pair.name]) {
        this.profitHistory[pair.name] = [];
      }
      this.profitHistory[pair.name].push(netProfit);
      
      // Keep only last 20 entries
      if (this.profitHistory[pair.name].length > 20) {
        this.profitHistory[pair.name].shift();
      }
      
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

  // NEW: Get current ETH price in USD
  async getETHPriceUSD() {
    try {
      // Using Chainlink Price Feed on Base
      const priceFeedABI = [
        "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)"
      ];
      
      const priceFeedAddress = '0x71041dddad3590f0b5ebbd392fb3e7b40b2e74b4'; // ETH/USD on Base
      const priceFeed = new ethers.Contract(priceFeedAddress, priceFeedABI, this.provider);
      
      const roundData = await priceFeed.latestRoundData();
      // Chainlink price feeds have 8 decimals
      return parseFloat(ethers.formatUnits(roundData.answer, 8));
    } catch (error) {
      console.error(colors.red + '❌ Error getting ETH price:' + colors.reset, error.message);
      // Return a default price if we can't fetch it
      return 3000.0;
    }
  }

  // ENHANCED: Improved optimal size calculation with more sophisticated analysis
  async findOptimalSize(pair) {
    const token0 = config.tokens[pair.token0];
    const token1 = config.tokens[pair.token1];
    const maxSize = config.settings.maxFlashloanAmount || 10;
    
    let bestSize = 0;
    let maxNetProfit = 0;
    
    // NEW: Adaptive step size based on pair volatility
    let steps = 5;
    if (this.profitHistory[pair.name] && this.profitHistory[pair.name].length > 5) {
      const volatility = this.calculateVolatility(this.profitHistory[pair.name]);
      if (volatility > 0.1) {
        steps = 8; // More steps for volatile pairs
      } else if (volatility < 0.02) {
        steps = 3; // Fewer steps for stable pairs
      }
    }
    
    for (let i = 1; i <= steps; i++) {
      const testSize = (maxSize / steps) * i;
      const netProfit = await this.calculateNetProfit(token0, token1, testSize, pair.fee, pair);
      
      if (netProfit > maxNetProfit) {
        maxNetProfit = netProfit;
        bestSize = testSize;
      }
    }
    
    // NEW: Fine-tune around the best size for more precision
    if (bestSize > 0 && steps > 3) {
      const stepSize = maxSize / steps / 2;
      for (let offset = -2; offset <= 2; offset++) {
        const testSize = bestSize + (offset * stepSize);
        if (testSize <= 0 || testSize > maxSize) continue;
        
        const netProfit = await this.calculateNetProfit(token0, token1, testSize, pair.fee, pair);
        if (netProfit > maxNetProfit) {
          maxNetProfit = netProfit;
          bestSize = testSize;
        }
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
      stable: pair.stable,
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

  // ENHANCED: Improved execution with better gas optimization and MEV protection
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

    console.log(colors.yellow + bold + '🚀 EXECUTING MEV-PROTECTED ARBITRAGE: ' + pair.name + colors.reset);
    
    try {
      const token0 = config.tokens[pair.token0];
      const token1 = config.tokens[pair.token1];
      
      // Verify contracts exist before proceeding
      const arbitrageContractExists = await this.checkContractExists(config.contracts.arbitrageContract);
      if (!arbitrageContractExists) {
        throw new Error('Arbitrage contract does not exist at the specified address');
      }
      
      const amountBorrow = this.parseAmount(optimalSize, token0.decimals);
      
      // NEW: More sophisticated minimum amount calculation
      const dynamicSlippage = this.calculateDynamicSlippage(pair, optimalSize);
      const minAmountOut = this.parseAmount(netProfit * (1 - dynamicSlippage), token0.decimals);

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
      
      // NEW: Use optimized gas prices
      const optimizedGas = await this.optimizeGasPrice();
      
      // NEW: Monitor for new blocks before submitting
      const currentBlock = await this.provider.getBlockNumber();
      if (currentBlock > this.lastBlockNumber) {
        this.lastBlockNumber = currentBlock;
        console.log(colors.cyan + '  📦 New block detected: ' + currentBlock + colors.reset);
      }
      
      // NEW: Add private transaction to mempool monitoring
      const tx = await this.arbitrageContract.initiateFlashloan(tradeParams, {
        type: 2, // EIP-1559
        maxPriorityFeePerGas: optimizedGas.maxPriorityFeePerGas,
        maxFeePerGas: optimizedGas.maxFeePerGas,
        gasLimit: config.settings.gasLimit
      });
      
      console.log(colors.green + '🛡️  Private Transaction Sent: ' + tx.hash + colors.reset);
      
      // NEW: Track transaction in pending set
      this.pendingTransactions.set(tx.hash, {
        timestamp: Date.now(),
        pair: pair.name,
        expectedProfit: netProfit
      });
      
      const receipt = await tx.wait();
      console.log(colors.green + '✅ Confirmed! Block: ' + receipt.blockNumber + ', Gas Used: ' + receipt.gasUsed + colors.reset);
      
      // NEW: Update metrics
      this.metrics.successfulArbitrages++;
      this.metrics.totalProfit += netProfit;
      this.metrics.averageGasUsed = (this.metrics.averageGasUsed * (this.metrics.successfulArbitrages - 1) + Number(receipt.gasUsed)) / this.metrics.successfulArbitrages;
      
      // Remove from pending transactions
      this.pendingTransactions.delete(tx.hash);
      
      // Reset failure count on success
      this.failureCount = 0;
    } catch (error) {
      console.error(colors.red + '❌ Execution Error:' + colors.reset, error.message);
      this.failureCount++;
      this.metrics.failedArbitrages++;
      
      if (error.code === 'INSUFFICIENT_FUNDS') {
        console.error(colors.red + '  ❗ Insufficient funds for gas' + colors.reset);
      } else if (error.message.includes('invalid chain id')) {
        console.error(colors.red + '  ❗ Chain ID mismatch. Check your RPC URL and network configuration.' + colors.reset);
      } else if (error.message.includes('Arbitrage contract does not exist')) {
        console.error(colors.red + '  ❗ Contract verification failed. Check contract address.' + colors.reset);
      } else if (error.message.includes('revert')) {
        console.error(colors.red + '  ❗ Transaction reverted. Possible sandwich attack or liquidity change.' + colors.reset);
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
      const startTime = Date.now();
      
      const { bestSize, maxNetProfit } = await this.findOptimalSize(pair);
      
      // Update scan time metrics
      const scanTime = Date.now() - startTime;
      this.metrics.scanTime.push(scanTime);
      if (this.metrics.scanTime.length > 20) {
        this.metrics.scanTime.shift();
      }
      
      if (maxNetProfit > config.settings.executionThreshold) {
        console.log(colors.green + bold + '🎯 ARBITRAGE OPPORTUNITY FOUND!' + colors.reset);
        console.log(colors.green + '  Pair: ' + pair.name + colors.reset);
        console.log(colors.green + '  Optimal Size: $' + bestSize.toFixed(2) + colors.reset);
        console.log(colors.green + '  Estimated Profit: $' + maxNetProfit.toFixed(2) + colors.reset);
        
        this.metrics.opportunitiesFound++;
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

  // NEW: Display performance metrics
  displayMetrics() {
    console.log(colors.magenta + '\n📊 PERFORMANCE METRICS' + colors.reset);
    console.log(colors.magenta + '  Total Scans: ' + this.metrics.totalScans + colors.reset);
    console.log(colors.magenta + '  Opportunities Found: ' + this.metrics.opportunitiesFound + colors.reset);
    console.log(colors.magenta + '  Successful Arbitrages: ' + this.metrics.successfulArbitrages + colors.reset);
    console.log(colors.magenta + '  Failed Arbitrages: ' + this.metrics.failedArbitrages + colors.reset);
    console.log(colors.magenta + '  Total Profit: $' + this.metrics.totalProfit.toFixed(2) + colors.reset);
    
    if (this.metrics.successfulArbitrages > 0) {
      console.log(colors.magenta + '  Average Gas Used: ' + Math.round(this.metrics.averageGasUsed) + colors.reset);
      console.log(colors.magenta + '  Success Rate: ' + (this.metrics.successfulArbitrages / (this.metrics.successfulArbitrages + this.metrics.failedArbitrages) * 100).toFixed(1) + '%' + colors.reset);
    }
    
    if (this.metrics.scanTime.length > 0) {
      const avgScanTime = this.metrics.scanTime.reduce((sum, time) => sum + time, 0) / this.metrics.scanTime.length;
      console.log(colors.magenta + '  Average Scan Time: ' + avgScanTime.toFixed(0) + 'ms' + colors.reset);
    }
    
    console.log(colors.magenta + '  Pending Transactions: ' + this.pendingTransactions.size + colors.reset);
    console.log(colors.magenta + '  Mempool Activity - High: ' + this.mempoolActivity.high + ', Medium: ' + this.mempoolActivity.medium + ', Low: ' + this.mempoolActivity.low + colors.reset);
  }

  async monitor() {
    console.log(colors.blue + bold + '\n🤖 Enhanced Base Arbitrage Bot: MEV PROTECTION ACTIVE' + colors.reset);
    console.log(colors.blue + 'Mode: ' + (this.wallet ? 'TRADING' : 'READ-ONLY MONITORING') + colors.reset);
    console.log(colors.blue + 'Scanning ' + config.pairs.filter(p => p.enabled !== false).length + ' enabled pairs every ' + (config.settings.scanInterval / 1000) + 's' + colors.reset);
    
    this.isRunning = true;
    let cycle = 1;
    
    // NEW: Display metrics every 10 cycles
    const metricsInterval = 10;
    
    while (this.isRunning) {
      console.log(colors.magenta + '\n═══════════════════════════════════════════════════' + colors.reset);
      console.log(colors.magenta + bold + '🔁 Scan Cycle #' + cycle + colors.reset);
      console.log(colors.magenta + bold + '⏰ ' + new Date().toLocaleTimeString() + colors.reset);
      
      // NEW: Monitor mempool before scanning
      await this.monitorMempool();
      
      // Only check enabled pairs
      const enabledPairs = config.pairs.filter(p => p.enabled !== false);
      await Promise.all(enabledPairs.map(pair => this.checkPair(pair)));
      
      this.metrics.totalScans++;
      
      // NEW: Display metrics at intervals
      if (cycle % metricsInterval === 0) {
        this.displayMetrics();
      }
      
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
      
      // NEW: Get initial block number
      this.lastBlockNumber = await this.provider.getBlockNumber();
      
    } catch (error) {
      console.error(colors.red + '❌ Connection Failed:' + colors.reset, error.message);
      process.exit(1);
    }
    await this.monitor();
  }
}

module.exports = ArbitrageBot;
