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
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn) external returns (uint256 amountOut)',
];

const UNISWAP_V2_ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
];

// ==================== DEX ADDRESSES ====================
const DEX_ADDRESSES = {
  UNISWAP_V3_QUOTER: '0x3d4e44eb1374240ce5f1b048ec6b6b9b660f40db',
  UNISWAP_V2_ROUTER: '0x8cFe327CEc63d7dC4E637C76Bb8F8e6Ff686Ef41',
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
    try {
      for (const fee of feeTiers) {
        try { return await this.quoterV3.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn); }
        catch { continue; }
      }
      return null;
    } catch (err) {
      console.log(`    ✗ V3 swap simulation error: ${err?.message || String(err)}`);
      return null;
    }
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
        console.log(`  Validating ${pair.token0.name}/${pair.token1.name}...`);
        const isValid = await this.validator.validatePair(pair.token0, pair.token1);
        if (!isValid) { console.log(`  ✗ ${pair.token0.name}/${pair.token1.name}: Validation failed`); continue; }
        console.log(`  ✓ ${pair.token0.name}/${pair.token1.name}: Valid tokens`);

        console.log(`  📊 Simulating swap of ${CONFIG.TRADE_SIZE} ${pair.token0.name}...`);
        const price1 = await this.prices.getPrice(pair.token0, pair.token1, pair.dex0, CONFIG.TRADE_SIZE);
        const price2 = await this.prices.getPrice(pair.token0, pair.token1, pair.dex1, CONFIG.TRADE_SIZE);
        if (!price1 || !price2) { console.log(`  ⚠ ${pair.token0.name}/${pair.token1.name}: Could not fetch prices from both DEXs`); continue; }

        const diff = this.calculateDifference(price1, price2, pair.token1.decimals, pair.token1.decimals);
        const p1Str = ethers.utils.formatUnits(price1, pair.token1.decimals);
        const p2Str = ethers.utils.formatUnits(price2, pair.token1.decimals);
        console.log(`    ${pair.dex0}: ${CONFIG.TRADE_SIZE} ${pair.token0.name} = ${parseFloat(p1Str).toFixed(6)} ${pair.token1.name}`);
        console.log(`    ${pair.dex1}: ${CONFIG.TRADE_SIZE} ${pair.token0.name} = ${parseFloat(p2Str).toFixed(6)} ${pair.token1.name}`);

        if (Math.abs(diff) >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
          const opp = { pair: `${pair.token0.name}/${pair.token1.name}`, dex0: pair.dex0, dex1: pair.dex1,
            priceDiff: diff, price1: p1Str, price2: p2Str, tradeSize: CONFIG.TRADE_SIZE, timestamp: new Date().toISOString() };
          this.opportunities.push(opp);
          await this.alert(opp);
          console.log(`  🎯 OPPORTUNITY: ${opp.pair} | Profit: ${diff.toFixed(2)}%`);
        } else {
          // ✅ Fixed template literal
          console.log(`    ℹ Spread: ${diff.toFixed(4)}% (below ${CONFIG.PRICE_DIFFERENCE_THRESHOLD}% threshold)`);
        }
      } catch (err) {
        console.error(`  Error: ${err?.message || String(err)}`);
      }
    }
  }
  calculateDifference(price1, price2, decimals0, decimals1) {
    const p1 = parseFloat(ethers.utils.formatUnits(price1, decimals0
