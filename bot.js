const { ethers } = require('ethers');
const chalk = require('chalk');
const config = require('./config');
const { QUOTER_V2_ABI, AERODROME_ROUTER_ABI } = require('./abis');

class ArbitrageBot {
  constructor() {
    // Use Environment Variables for security if available, otherwise fallback to config
    const rpcUrl = process.env.PRIVATE_RPC_URL || config.PRIVATE_RPC_URL || config.BASE_RPC_URL;
    const chainId = config.CHAIN_ID || 8453;
    const privateKey = process.env.PRIVATE_KEY || config.PRIVATE_KEY;

    console.log(chalk.blue(`📡 Initializing PRODUCTION Mode for Chain ID ${chainId}...`));
    
    try {
      this.provider = new ethers.JsonRpcProvider(rpcUrl, chainId, {
        staticNetwork: true
      });
      
      if (privateKey) {
        this.wallet = new ethers.Wallet(privateKey, this.provider);
        console.log(chalk.green(`✅ Wallet loaded: ${this.wallet.address}`));
      } else {
        console.warn(chalk.yellow('⚠️  No Private Key found. Bot will run in READ-ONLY mode.'));
      }
    } catch (error) {
      console.error(chalk.red('❌ Initialization Failed:'), error.message);
      process.exit(1);
    }

    const uniswapQuoterAddr = config.contracts.uniswapQuoterV2;
    const aerodromeRouterAddr = config.contracts.aerodromeRouter;
    const arbitrageContractAddr = config.contracts.arbitrageContract;

    this.uniswapQuoter = new ethers.Contract(uniswapQuoterAddr, QUOTER_V2_ABI, this.provider);
    this.aerodromeRouter = new ethers.Contract(aerodromeRouterAddr, AERODROME_ROUTER_ABI, this.provider);
    
    this.arbitrageContract = new ethers.Contract(
      arbitrageContractAddr,
      ['function initiateFlashloan(tuple(address tokenBorrow, uint256 amountBorrow, address tokenIn, address tokenOut, uint256 minAmountOut, bytes swapDataA, bytes swapDataB)) external'],
      this.provider
    );

    this.isRunning = false;
    this.opportunitiesFound = 0;
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
    const flashloanFee = amountIn * buyPrice * 0.0005;
    const gasFee = 0.20;

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

  encodeAerodromeSwap(tokenIn, tokenOut, amountIn, amountOutMin) {
    const iface = new ethers.Interface(AERODROME_ROUTER_ABI);
    const routes = [{ from: tokenIn.address, to: tokenOut.address, stable: false, factory: config.contracts.aerodromeFactory }];
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
    const iface = new ethers.Interface(['function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)']);
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
    if (!this.wallet) {
      console.log(chalk.red('❌ Cannot execute: No wallet/private key loaded.'));
      return;
    }

    console.log(chalk.yellow.bold(`🚀 EXECUTING LIVE ARBITRAGE: ${pair.token0}/${pair.token1}`));
    
    try {
      const token0 = config.tokens[pair.token0];
      const token1 = config.tokens[pair.token1];
      
      const amountBorrow = this.parseAmount(optimalSize, token0.decimals);
      const minAmountOut = this.parseAmount(netProfit * 0.9, token0.decimals);

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

      const contractWithSigner = this.arbitrageContract.connect(this.wallet);
      const tx = await contractWithSigner.initiateFlashloan(tradeParams);
      console.log(chalk.green(`✅ Transaction Sent: ${tx.hash}`));
      const receipt = await tx.wait();
      console.log(chalk.green(`✅ Confirmed in block ${receipt.blockNumber}`));
    } catch (error) {
      console.error(chalk.red('❌ Execution Error:'), error.message);
    }
  }

  async checkPair(pair) {
    const { bestSize, maxNetProfit } = await this.findOptimalSize(pair);
    if (maxNetProfit > config.settings.executionThreshold) {
      this.opportunitiesFound++;
      await this.executeArbitrage(pair, bestSize, maxNetProfit);
    }
  }

  async monitor() {
    console.log(chalk.blue.bold('\n🤖 Base Arbitrage Bot: LIVE PRODUCTION ACTIVE'));
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
    } catch (error) {
      console.error(chalk.red('❌ Connection Failed:'), error.message);
      process.exit(1);
    }
    await this.monitor();
  }
}

module.exports = ArbitrageBot;
