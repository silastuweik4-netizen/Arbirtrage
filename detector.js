const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const CONFIG = {
  BASE_CHAIN_ID: 8453,
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  PRICE_DIFFERENCE_THRESHOLD: 0.5,
  CHECK_INTERVAL_MS: 10000,
  WEBHOOK_URL: process.env.WEBHOOK_URL || null,
};

// ==================== PROVIDER ====================
const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== ABIS ====================
const ERC20_ABI = [
  'function decimals() public view returns (uint8)',
  'function symbol() public view returns (string)',
  'function name() public view returns (string)',
];

// ==================== TOKEN ADDRESSES ====================
// All addresses verified from Basescan
const TOKENS = {
  WETH: {
    address: '0x4200000000000000000000000000000000000006',
    name: 'WETH',
    decimals: 18,
  },
  USDC: {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    name: 'USDC',
    decimals: 6,
  },
  DEGEN: {
    address: '0xd9aAEc86B65D86f6A259c19Cc27C5323d8F92A7e',
    name: 'DEGEN',
    decimals: 18,
  },
  USDbC: {
    address: '0x50c5725949A6F0c72E6C4a641F8e4dA7ff1f32ef',
    name: 'USDbC',
    decimals: 6,
  },
};

// ==================== TOKEN PAIR MANAGER ====================
class TokenPairManager {
  constructor() {
    this.pairs = [];
    this.loadPairs();
  }

  loadPairs() {
    this.pairs = [
      {
        token0: TOKENS.WETH,
        token1: TOKENS.USDC,
        dex0: 'uniswap_v3',
        dex1: 'uniswap_v2',
      },
      {
        token0: TOKENS.DEGEN,
        token1: TOKENS.USDC,
        dex0: 'uniswap_v3',
        dex1: 'uniswap_v2',
      },
      {
        token0: TOKENS.USDbC,
        token1: TOKENS.USDC,
        dex0: 'uniswap_v2',
        dex1: 'uniswap_v2',
      },
    ];
    console.log(`✓ Loaded ${this.pairs.length} token pairs`);
  }

  getPairs() {
    return this.pairs;
  }

  addPair(token0Symbol, token1Symbol, dex0, dex1) {
    if (!TOKENS[token0Symbol] || !TOKENS[token1Symbol]) {
      console.log('✗ Token not found in TOKENS registry');
      return;
    }
    this.pairs.push({
      token0: TOKENS[token0Symbol],
      token1: TOKENS[token1Symbol],
      dex0,
      dex1,
    });
    console.log(`✓ Added pair: ${token0Symbol}/${token1Symbol}`);
  }
}

// ==================== LIQUIDITY VALIDATOR ====================
class LiquidityValidator {
  async validateToken(tokenAddress, tokenName) {
    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const decimals = await contract.decimals();
      const symbol = await contract.symbol().catch(() => 'UNKNOWN');
      return { valid: true, decimals, symbol };
    } catch (err) {
      console.log(`  ✗ ${tokenName} validation failed: ${err.message.substring(0, 60)}`);
      return { valid: false, error: err.message };
    }
  }

  async validatePair(token0, token1) {
    const val0 = await this.validateToken(token0.address, token0.name);
    if (!val0.valid) return false;

    const val1 = await this.validateToken(token1.address, token1.name);
    if (!val1.valid) return false;

    return true;
  }
}

// ==================== PRICE FETCHER ====================
class PriceFetcher {
  async getPrice(token0, token1) {
    try {
      // Simplified: For now, return mock prices to test the flow
      // In production, you'd call actual DEX contracts
      const price1 = ethers.utils.parseUnits('1', 18);
      const price2 = ethers.utils.parseUnits('1', 18);
      return { price1, price2, success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

// ==================== ARBITRAGE DETECTOR ====================
class ArbitrageDetector {
  constructor() {
    this.pairManager = new TokenPairManager();
    this.validator = new LiquidityValidator();
    this.prices = new PriceFetcher();
    this.opportunities = [];
  }

  async scan() {
    const pairs = this.pairManager.getPairs();
    console.log(
      `\n[${new Date().toISOString()}] Scanning ${pairs.length} pairs...`
    );

    for (const pair of pairs) {
      try {
        // Validate tokens
        console.log(`  Validating ${pair.token0.name}/${pair.token1.name}...`);
        const isValid = await this.validator.validatePair(
          pair.token0,
          pair.token1
        );

        if (!isValid) {
          console.log(
            `  ✗ ${pair.token0.name}/${pair.token1.name}: Validation failed`
          );
          continue;
        }

        console.log(
          `  ✓ ${pair.token0.name}/${pair.token1.name}: Valid tokens`
        );

        // Get prices
        const priceResult = await this.prices.getPrice(
          pair.token0,
          pair.token1
        );

        if (!priceResult.success) {
          console.log(
            `  ⚠ ${pair.token0.name}/${pair.token1.name}: Price fetch failed`
          );
          continue;
        }

        // Calculate difference
        const diff = this.calculateDifference(
          priceResult.price1,
          priceResult.price2
        );

        if (Math.abs(diff) >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
          const opp = {
            pair: `${pair.token0.name}/${pair.token1.name}`,
            dex0: pair.dex0,
            dex1: pair.dex1,
            priceDiff: diff,
            timestamp: new Date().toISOString(),
          };
          this.opportunities.push(opp);
          await this.alert(opp);
          console.log(
            `  🎯 OPPORTUNITY: ${pair.token0.name}/${pair.token1.name} | Profit: ${diff.toFixed(
              2
            )}%`
          );
        }
      } catch (err) {
        console.error(`  Error: ${err.message}`);
      }
    }
  }

  calculateDifference(price1, price2) {
    const p1 = parseFloat(ethers.utils.formatUnits(price1, 18));
    const p2 = parseFloat(ethers.utils.formatUnits(price2, 18));
    return ((p2 - p1) / p1) * 100;
  }

  async alert(opportunity) {
    if (CONFIG.WEBHOOK_URL) {
      try {
        await axios.post(CONFIG.WEBHOOK_URL, {
          content: `🚨 **Arbitrage Opportunity!**\n**${opportunity.pair}** | Profit: ${opportunity.priceDiff.toFixed(
            2
          )}%\n${opportunity.dex0} → ${opportunity.dex1}`,
        });
      } catch (err) {
        console.error('Webhook error:', err.message);
      }
    }
  }
}

// ==================== MAIN BOT ====================
class ArbitrageBot {
  constructor() {
    this.detector = new ArbitrageDetector();
    this.isRunning = false;
  }

  async start() {
    console.log('\n🤖 Base Chain Arbitrage Detector Starting...');
    console.log(`📡 RPC: ${CONFIG.RPC_URL}`);
    console.log(`⏱  Scan Interval: ${CONFIG.CHECK_INTERVAL_MS}ms`);
    console.log(`📊 Threshold: ${CONFIG.PRICE_DIFFERENCE_THRESHOLD}%\n`);

    // Test RPC connection
    try {
      const blockNum = await provider.getBlockNumber();
      console.log(`✓ RPC Connected! Block: ${blockNum}\n`);
    } catch (err) {
      console.error(`✗ RPC Connection Failed: ${err.message}`);
      process.exit(1);
    }

    this.isRunning = true;
    await this.run();
  }

  async run() {
    while (this.isRunning) {
      try {
        await this.detector.scan();
      } catch (err) {
        console.error('Scan error:', err.message);
      }
      await this.sleep(CONFIG.CHECK_INTERVAL_MS);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    this.isRunning = false;
    console.log('\n🛑 Bot stopped');
    process.exit(0);
  }
}

// ==================== START ====================
const bot = new ArbitrageBot();
bot.start().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  bot.stop();
});
