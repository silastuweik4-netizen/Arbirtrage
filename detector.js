const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const CONFIG = {
  BASE_CHAIN_ID: 8453,
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  UNISWAP_V3_ROUTER: '0x2626664c2603336e57b271c5c0b26f421741e481',
  UNISWAP_V3_QUOTER: '0x3d4e44eb1374240ce5f1b048ec6b6b9b660f40db',
  UNISWAP_V2_ROUTER: '0x4752ba5dbc23f44965137d9d15cbbff66ad727d5',
  AERODROME_ROUTER: '0xcf77a3ba9a5ca922335eaadaf6447cbb7e5d2ccc',
  MIN_LIQUIDITY_USD: 10000, // Min liquidity threshold
  PRICE_DIFFERENCE_THRESHOLD: 0.5, // Min 0.5% difference to alert
  CHECK_INTERVAL_MS: 10000, // Check every 10 seconds
  WEBHOOK_URL: process.env.WEBHOOK_URL || null,
};

// ==================== PROVIDER SETUP ====================
const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== ABIS ====================
const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn) public returns (uint256 amountOut)',
];

const UNISWAP_V2_ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
];

const ERC20_ABI = [
  'function decimals() public view returns (uint8)',
  'function balanceOf(address account) external view returns (uint256)',
  'function name() public view returns (string)',
  'function symbol() public view returns (string)',
];

// ==================== TOKEN PAIR DATABASE ====================
class TokenPairManager {
  constructor() {
    this.pairs = [];
    this.loadBasePairs();
  }

  loadBasePairs() {
    // Base Chain tokens - verified addresses from Basescan
    // Start with just ETH/USDC to test
    this.pairs = [
      {
        token0: '0x4200000000000000000000000000000000000006', // WETH (canonical Base ETH wrapper)
        token1: '0x833589fCD6eDb6E08f4c7C32D4f71b3566dA8aEF', // USDC (official Circle USDC)
        name0: 'WETH',
        name1: 'USDC',
        dex0: 'uniswap_v3',
        dex1: 'uniswap_v2',
      },
    ];
    console.log('✓ Loaded 1 test pair (WETH/USDC)');
  }

  // Add custom token pairs
  addPair(token0, token1, name0, name1, dex0 = 'uniswap_v3', dex1 = 'aerodrome') {
    this.pairs.push({ token0, token1, name0, name1, dex0, dex1 });
    console.log(`✓ Added pair: ${name0}/${name1}`);
  }

  getPairs() {
    return this.pairs;
  }
}

// ==================== LIQUIDITY VALIDATOR ====================
class LiquidityValidator {
  async validateTokens(token0, token1) {
    try {
      const erc20_0 = new ethers.Contract(token0, ERC20_ABI, provider);
      const erc20_1 = new ethers.Contract(token1, ERC20_ABI, provider);

      // Check if tokens exist and have valid decimals
      let decimals0, decimals1, symbol0, symbol1;
      
      try {
        decimals0 = await erc20_0.decimals();
      } catch (e) {
        console.log(`  └─ Token0 decimals call failed: ${e.message.substring(0, 50)}`);
        return { valid: false, reason: `Token0 call failed` };
      }

      try {
        decimals1 = await erc20_1.decimals();
      } catch (e) {
        console.log(`  └─ Token1 decimals call failed: ${e.message.substring(0, 50)}`);
        return { valid: false, reason: `Token1 call failed` };
      }

      try {
        [symbol0, symbol1] = await Promise.all([
          erc20_0.symbol().catch(() => 'UNKNOWN'),
          erc20_1.symbol().catch(() => 'UNKNOWN'),
        ]);
      } catch (e) {
        symbol0 = 'UNKNOWN';
        symbol1 = 'UNKNOWN';
      }

      if (!decimals0 || !decimals1) {
        return { valid: false, reason: 'Invalid token decimals' };
      }

      return { valid: true, decimals0, decimals1, symbol0, symbol1 };
    } catch (err) {
      return { valid: false, reason: err.message };
    }
  }
}

// ==================== PRICE FETCHER ====================
class PriceFetcher {
  constructor() {
    this.quoter = new ethers.Contract(
      CONFIG.UNISWAP_V3_QUOTER,
      UNISWAP_V3_QUOTER_ABI,
      provider
    );
    this.routerV2 = new ethers.Contract(
      CONFIG.UNISWAP_V2_ROUTER,
      UNISWAP_V2_ROUTER_ABI,
      provider
    );
  }

  async getUniswapV3Price(tokenIn, tokenOut, fee = 3000, amountIn = ethers.utils.parseUnits('1', 18)) {
    try {
      const amountOut = await this.quoter.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn);
      return amountOut;
    } catch (err) {
      return null;
    }
  }

  async getUniswapV2Price(tokenIn, tokenOut, amountIn = ethers.utils.parseUnits('1', 18)) {
    try {
      const amounts = await this.routerV2.getAmountsOut(amountIn, [tokenIn, tokenOut]);
      return amounts[1];
    } catch (err) {
      return null;
    }
  }

  async getPrice(token0, token1, dex) {
    const amountIn = ethers.utils.parseUnits('1', 18);
    if (dex === 'uniswap_v3') {
      return await this.getUniswapV3Price(token0, token1, 3000, amountIn);
    } else if (dex === 'aerodrome' || dex === 'uniswap_v2') {
      return await this.getUniswapV2Price(token0, token1, amountIn);
    }
    return null;
  }
}

// ==================== ARBITRAGE DETECTOR ====================
class ArbitrageDetector {
  constructor() {
    this.pairManager = new TokenPairManager();
    this.liquidity = new LiquidityValidator();
    this.prices = new PriceFetcher();
    this.opportunities = [];
  }

  async detectOpportunities() {
    const pairs = this.pairManager.getPairs();
    console.log(`\n[${new Date().toISOString()}] Scanning ${pairs.length} pairs...`);

    for (const pair of pairs) {
      try {
        // Validate tokens
        const validation = await this.liquidity.validateTokens(pair.token0, pair.token1);
        if (!validation.valid) {
          console.log(`✗ ${pair.name0}/${pair.name1}: ${validation.reason}`);
          continue;
        }

        // Get prices from both DEXs
        const price1 = await this.prices.getPrice(pair.token0, pair.token1, pair.dex0);
        const price2 = await this.prices.getPrice(pair.token0, pair.token1, pair.dex1);

        if (!price1 || !price2) {
          console.log(`⚠ ${pair.name0}/${pair.name1}: Could not fetch prices`);
          continue;
        }

        // Calculate price difference
        const priceDiff = this.calculatePriceDifference(price1, price2);
        const profitMargin = Math.abs(priceDiff);

        if (profitMargin >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
          const opp = {
            token0: pair.name0,
            token1: pair.name1,
            dex0: pair.dex0,
            dex1: pair.dex1,
            price1: ethers.utils.formatUnits(price1, 18),
            price2: ethers.utils.formatUnits(price2, 18),
            priceDifference: priceDiff,
            profitMargin: profitMargin,
            timestamp: new Date().toISOString(),
          };

          this.opportunities.push(opp);
          await this.alertOpportunity(opp);
          console.log(
            `🎯 OPPORTUNITY: ${pair.name0}/${pair.name1} | Profit: ${profitMargin.toFixed(2)}% | ${pair.dex0} → ${pair.dex1}`
          );
        }
      } catch (err) {
        console.error(`Error scanning ${pair.name0}/${pair.name1}:`, err.message);
      }
    }
  }

  calculatePriceDifference(price1, price2) {
    const p1 = parseFloat(ethers.utils.formatUnits(price1, 18));
    const p2 = parseFloat(ethers.utils.formatUnits(price2, 18));
    return ((p2 - p1) / p1) * 100;
  }

  async alertOpportunity(opportunity) {
    if (CONFIG.WEBHOOK_URL) {
      try {
        await axios.post(CONFIG.WEBHOOK_URL, {
          content: `🚨 **Arbitrage Opportunity Detected!**\n\n**Pair:** ${opportunity.token0}/${opportunity.token1}\n**Profit Margin:** ${opportunity.profitMargin.toFixed(2)}%\n**From:** ${opportunity.dex0}\n**To:** ${opportunity.dex1}`,
        });
      } catch (err) {
        console.error('Webhook error:', err.message);
      }
    }
  }

  getOpportunities() {
    return this.opportunities;
  }
}

// ==================== MAIN DETECTOR ====================
class ArbitrageBot {
  constructor() {
    this.detector = new ArbitrageDetector();
    this.isRunning = false;
  }

  async start() {
    console.log('🤖 Base Chain Arbitrage Detector Starting...');
    console.log(`📡 RPC: ${CONFIG.RPC_URL}`);
    console.log(`⏱ Check Interval: ${CONFIG.CHECK_INTERVAL_MS}ms`);
    console.log(`💰 Min Liquidity: ${CONFIG.MIN_LIQUIDITY_USD}`);
    console.log(`📊 Price Diff Threshold: ${CONFIG.PRICE_DIFFERENCE_THRESHOLD}%\n`);

    // Test RPC connection
    try {
      const blockNum = await provider.getBlockNumber();
      console.log(`✓ RPC Connected! Current block: ${blockNum}\n`);
    } catch (err) {
      console.error(`✗ RPC Connection Failed: ${err.message}`);
      console.error('Check your RPC_URL in .env file');
      process.exit(1);
    }

    this.isRunning = true;

    // Start monitoring loop
    await this.monitor();
  }

  async monitor() {
    while (this.isRunning) {
      try {
        await this.detector.detectOpportunities();
      } catch (err) {
        console.error('Monitor error:', err.message);
      }
      await this.sleep(CONFIG.CHECK_INTERVAL_MS);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    this.isRunning = false;
    console.log('🛑 Bot stopped');
  }
}

// ==================== START DETECTOR ====================
const bot = new ArbitrageBot();
bot.start().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  bot.stop();
  process.exit(0);
});
