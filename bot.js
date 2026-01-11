// bot.js
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
      // Lava-Net needs an auth header – add it only to the scanning provider
      this.provider = new ethers.JsonRpcProvider(
        {
          url: scanRpcUrl,
          headers: { Authorization: 'Bearer 74c33b48f194b4900d1b1d4b108fd2ae' }
        },
        chainId,
        { staticNetwork: true }
      );
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
      ['function initiateFlashloan(tuple(address tokenBorrow,uint256 amountBorrow,address tokenIn,address tokenOut,uint256 minAmountOut,bytes swapDataA,bytes swapDataB)) external'],
      this.wallet || this.executionProvider
    );

    this.isRunning = false;
  }

  formatAmount(amount, decimals) { return ethers.formatUnits(amount, decimals); }
  parseAmount(amount, decimals) {
    const fixedAmount = parseFloat(amount).toFixed(decimals);
    return ethers.parseUnits(fixedAmount, decimals);
  }

  /* ---------- quote helpers ---------- */

  async getUniswapQuote(tokenIn, tokenOut, amountIn, fee) {
    if (!tokenIn || !tokenOut) {
      console.log('[UNI] Missing token config', tokenIn, tokenOut);
      return { success: false };
    }
    try {
      const params = {
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountIn: this.parseAmount(amountIn, tokenIn.decimals),
        fee: fee,
        sqrtPriceLimitX96: 0
      };
      const result = await this.uniswapQuoter.quoteExactInputSingle.staticCall(params);
      const out = this.formatAmount(result[0], tokenOut.decimals);
      console.log(`[UNI] ${tokenIn.symbol}→${tokenOut.symbol}  amountIn=${amountIn}  fee=${fee}  amountOut=${out}`);
      return { amountOut: parseFloat(out), success: true };
    } catch (e) {
      console.log(`[UNI] ${tokenIn.symbol}→${tokenOut.symbol}  ERROR:`, e.code, e.message);
      return { success: false };
    }
  }

  async getAerodromeQuote(tokenIn, tokenOut, amountIn) {
    if (!tokenIn || !tokenOut) {
      console.log('[AERO] Missing token config', tokenIn, tokenOut);
      return { success: false };
    }
    try {
      const routes = [{ from: tokenIn.address, to: tokenOut.address, stable: false, factory: config.contracts.aerodromeFactory }];
      const amounts = await this.aerodromeRouter.getAmountsOut(this.parseAmount(amountIn, tokenIn.decimals), routes);
      const out = this.formatAmount(amounts[1], tokenOut.decimals);
      console.log(`[AERO] ${tokenIn.symbol}→${tokenOut.symbol}  amountIn=${amountIn}  amountOut=${out}`);
      return { amountOut: parseFloat(out), success: true };
    } catch (e) {
      console.log(`[AERO] ${tokenIn.symbol}→${tokenOut.symbol}  ERROR:`, e.code, e.message);
      return { success: false };
    }
  }

  /* ---------- profit calc ---------- */

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

  /* ---------- optimal size ---------- */

  async findOptimalSize(pair) {
    const token0 = config.tokens[pair.token0];
    const token1 = config.tokens[pair.token1];
    if (!token0 || !token1) {
      console.log('Missing token config for pair', pair);
      return { bestSize: 0, maxNetProfit: -1 };
    }
    const maxSize = config.settings.depthAmount || 10;
    let bestSize = 0, maxNetProfit = 0, steps = 10;
    for (let i = 1; i <= steps; i++) {
      const testSize = (maxSize / steps) * i;
      const netProfit = await this.calculateNetProfit(token0, token1, testSize, pair.fee);
      if (netProfit > maxNetProfit) { maxNetProfit = netProfit; bestSize = testSize; }
    }
    return { bestSize, maxNetProfit };
  }

  /* ---------- calldata builders ---------- */

  encodeAerodromeSwap(tokenIn, tokenOut, amountIn, amountOutMin) {
    const iface = new ethers.Interface([
      'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,(address from,address to,bool stable,address factory)[] routes,address to,uint256 deadline) external returns (uint256[])'
    ]);
    const routes = [{ from: tokenIn.address, to: tokenOut.address, stable: false, factory: config.contracts.aerodromeFactory }];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    return iface.encodeFunctionData('swapExactTokensForTokens', [amountIn, amountOutMin, routes, config.contracts.arbitrageContract, deadline]);
  }

  encodeUniswapSwap(tokenIn, tokenOut, amountIn, amountOutMin, fee) {
    const iface = new ethers.Interface([
      'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) external returns (uint256)'
    ]);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const params = {
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      fee,
      recipient: config.contracts.arbitrageContract,
      deadline,
      amountIn,
      amountOutMinimum: amountOutMin,
      sqrtPriceLimitX96: 0
    };
    return iface.encodeFunctionData('exactInputSingle', [params]);
  }

  /* ---------- execution ---------- */

  async executeArbitrage(pair, optimalSize, netProfit) {
    if (!this.wallet) return;
    if (config.contracts.arbitrageContract === '0x0000000000000000000000000000000000000000') {
      console.log(chalk.yellow(`⚠️  Opportunity found for ${pair.token0}/${pair.token1} ($${netProfit.toFixed(2)}), but no contract address is set.`));
      return;
    }
    console.log(chalk.yellow.bold(`🚀 EXECUTING MEV-PROTECTED ARBITRAGE: ${pair.token0}/${pair.token1}`));
    try {
      const token0 = config.tokens[pair.token0];
      const token1 = config.tokens[pair.token1];
      if (!token0 || !token1) throw new Error('Token config missing');

      const amountBorrow = this.parseAmount(optimalSize, token0.decimals);
      const minAmountOut = this.parseAmount(netProfit * 0.9, token0.decimals);

      const uniQuote = await this.getUniswapQuote(token0, token1, optimalSize, pair.fee);
      const aeroQuote = await this.getAerodromeQuote(token0, token1, optimalSize);
      if (!uniQuote.success || !aeroQuote.success) return;

      let swapDataA, swapDataB;
      if (uniQuote.amountOut < aeroQuote.amountOut) {
        swapDataA = this.encodeUniswapSwap(token0, token1, amountBorrow, 0, pair.fee);
        swapDataB = this.encodeAerodromeSwap(token1, token0, this.parseAmount(uniQuote.amountOut, token1.decimals), 0);
      } else {
        swapDataA = this.encodeAerodromeSwap(token0, token1, amountBorrow, 0);
        swapDataB = this.encodeUniswapSwap(token1, token0, this.parseAmount(aeroQuote.amountOut, token1.decimals), 0, pair.fee);
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

      const tx = await this.arbitrageContract.initiateFlashloan(tradeParams);
      console.log(chalk.green(`🛡️  Private Transaction Sent: ${tx.hash}`));
      await tx.wait();
      console.log(chalk.green(`✅ Confirmed!`));
    } catch (error) {
      console.error(chalk.red('❌ Execution Error:'), error.message);
    }
  }

  async checkPair(pair) {
    const { bestSize, maxNetProfit } = await this.findOptimalSize(pair);
    if (maxNetProfit > config.settings.executionThreshold) await this.executeArbitrage(pair, bestSize, maxNetProfit);
  }

  async monitor() {
    console.log(chalk.blue.bold('\n🤖 Base Arbitrage Bot: MEV PROTECTION ACTIVE'));
    this.isRunning = true;
    while (this.isRunning) {
      await Promise.all(config.pairs.map(p => this.checkPair(p)));
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
