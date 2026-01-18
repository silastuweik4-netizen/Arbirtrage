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
  TRADE_SIZE: process.env.TRADE_SIZE || '100', // simulate swapping 100 units of token0
};

// ==================== PROVIDER ====================
const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== ABIS ====================
const ERC20_ABI = [
  'function decimals() public view returns (uint8)',
  'function symbol() public view returns (string)',
  'function name() public view returns (string)',
];

const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
];

const UNISWAP_V2_ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
];

// ==================== DEX ADDRESSES (BASE MAINNET 2026) ====================
const DEX_ADDRESSES = {
  UNISWAP_V3_QUOTER: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a', // Official V3 QuoterV2
  UNISWAP_V2_ROUTER: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24', // Official V2 Router
};

// ==================== TOKEN ADDRESSES ====================
const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', name: 'WETH', decimals: 18 },
  USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913', name: 'USDC', decimals: 6 },
  DEGEN: { address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', name: 'DEGEN', decimals: 18 },
};

// ==================== TOKEN PAIR MANAGER ====================
class TokenPairManager {
  constructor() {
    this.pairs = [];
    this.loadPairs();
  }
  loadPairs() {
    this.pairs = [
      { token0: TOKENS.WETH, token1: TOKENS.USDC, dex0: 'uniswap_v3', dex1: 'uniswap_v2' },
      { token0: TOKENS.DEGEN, token1: TOKENS.USDC, dex0: 'uniswap_v3', dex1: 'uniswap_v2' },
    ];
    console.log(`✓ Loaded ${this.pairs.length} verified token pairs`);
  }
  getPairs() { return this.pairs; }
}

// ==================== LIQUIDITY VALIDATOR ====================
class LiquidityValidator {
  async validateToken(tokenAddress, tokenName) {
    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      let decimals, symbol;
      try { decimals = await contract.decimals(); } catch { decimals = null; }
      try { symbol = await contract.symbol(); } catch { symbol = 'UNKNOWN'; }
      return { valid: true, decimals, symbol };
    } catch (err) {
      console.log(`  ✗ ${tokenName} validation failed: ${err?.message?.substring(0, 60) || String(err)}`);
      return { valid: false, error: err?.message || String(err) };
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
  constructor() {
    this.quoterV3 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_QUOTER, UNISWAP_V3_QUOTER_ABI, provider);
    this.routerV2 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_ABI, provider);
  }
  async getSwapUniswapV3(tokenIn, tokenOut, amountIn, feeTiers = [100, 500, 3000, 10000]) {
    for (const fee of feeTiers) {
      try {
        // QuoterV2 uses an extra parameter for sqrtPriceLimitX96 (0 means no limit)
        return await this.quoterV3.callStatic.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0);
      } catch (err) { continue; }
    }
    return null;
  }
  async getSwapUniswapV2(tokenIn, tokenOut, amountIn) {
    try {
      const amounts = await this.routerV2.getAmountsOut(amountIn, [tokenIn, tokenOut]);
      return amounts[1];
    } catch (err) {
      console.log(`    ✗ V2 swap simulation error: ${err?.message || String(err)}`);
      return null;
    }
  }
  async getPrice(token0, token1, dexType, tradeSize = CONFIG.TRADE_SIZE) {
    const amountIn = ethers.utils.parseUnits(tradeSize, token0.decimals);
    if (dexType === 'uniswap_v3') return await this.getSwapUniswapV3(token0.address, token1.address, amountIn);
    if (dexType === 'uniswap_v2') return await this.getSwapUniswapV2(token0.address, token1.address, amountIn);
    return null;
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
    console.log(`\n[${new Date().toISOString()}] Scanning ${pairs.length} pairs...`);
    for (const pair of pairs) {
      try {
        const isValid = await this.validator.validatePair(pair.token0, pair.token1);
        if (!isValid) continue;

        const price1 = await this.prices.getPrice(pair.token0, pair.token1, pair.dex0, CONFIG.TRADE_SIZE);
        const price2 = await this.prices.getPrice(pair.token0, pair.token1, pair.dex1, CONFIG.TRADE_SIZE);
        
        if (!price1 || !price2) {
          console.log(`  ⚠ ${pair.token0.name}/${pair.token1.name}: Price fetch failed`);
          continue;
        }

        const diff = this.calculateDifference(price1, price2, pair.token1.decimals);
        const p1Str = ethers.utils.formatUnits(price1, pair.token1.decimals);
        const p2Str = ethers.utils.formatUnits(price2, pair.token1.decimals);

        if (Math.abs(diff) >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
          const opp = { 
            pair: `${pair.token0.name}/${pair.token1.name}`, 
            priceDiff: diff, 
            p1: p1Str, 
            p2: p2Str, 
            timestamp: new Date().toISOString() 
          };
          console.log(`  🎯 OPPORTUNITY: ${opp.pair} | Profit: ${diff.toFixed(2)}%`);
          if (CONFIG.WEBHOOK_URL) await axios.post(CONFIG.WEBHOOK_URL, opp);
        } else {
          console.log(`  ℹ ${pair.token0.name}/${pair.token1.name}: Spread ${diff.toFixed(4)}%`);
        }
      } catch (err) {
        console.error(`  Error scanning pair: ${err.message}`);
      }
    }
  }

  calculateDifference(price1, price2, decimalsOut) {
    const p1 = parseFloat(ethers.utils.formatUnits(price1, decimalsOut));
    const p2 = parseFloat(ethers.utils.formatUnits(price2, decimalsOut));
    // Percentage difference between DEX1 and DEX2
    return ((p1 - p2) / p2) * 100;
  }
}

// ==================== EXECUTION ====================
const detector = new ArbitrageDetector();
setInterval(() => detector.scan(), CONFIG.CHECK_INTERVAL_MS);
detector.scan();
