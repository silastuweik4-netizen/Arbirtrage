const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const CONFIG = {
  BASE_CHAIN_ID: 8453,
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  PRICE_DIFFERENCE_THRESHOLD: parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD) || 0.5, // %
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS) || 10000,
  WEBHOOK_URL: process.env.WEBHOOK_URL || null,
  TRADE_SIZE: process.env.TRADE_SIZE || '1', // in token0 units
  MIN_LIQUIDITY_USD: parseInt(process.env.MIN_LIQUIDITY_USD) || 1000,
};

const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== ABIS ====================
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)'
];
const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle(address,address,uint24,uint256,uint160) external view returns (uint256)'
];
const UNISWAP_V2_ROUTER_ABI = [
  'function getAmountsOut(uint,address[]) view returns (uint[])'
];
const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint256,tuple(address from,address to,bool stable,address factory)[]) view returns (uint256[])'
];
const UNISWAP_V3_FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const UNISWAP_V2_FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const AERODROME_FACTORY_ABI = ['function getPool(address,address,bool) view returns (address)'];

// ==================== DEX ADDRESSES ====================
const DEX_ADDRESSES = {
  UNISWAP_V3_QUOTER: '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6',
  UNISWAP_V2_ROUTER: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  AERODROME_ROUTER: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  AERODROME_FACTORY: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
  UNISWAP_V3_FACTORY: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  UNISWAP_V2_FACTORY: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
};

// ==================== TOKEN PRICES (USD) ====================
const TOKEN_PRICES_USD = {
  WETH: 2500,
  USDC: 1,
  USDT: 1,
  DAI: 1,
  VIRTUAL: 5,
  // add others as needed
};

// ==================== VERIFIED TOKENS ====================
const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', name: 'WETH', decimals: 18 },
  USDC: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'USDC', decimals: 6 },
  USDT: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', name: 'USDT', decimals: 6 },
  DAI: { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', name: 'DAI', decimals: 18 },
  VIRTUAL: { address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', name: 'VIRTUAL', decimals: 18 },
  // add others as needed
};

// ==================== EXPLICIT VIRTUAL POOLS ====================
const VIRTUAL_POOLS = [
  {
    dex: 'aerodrome',
    pairAddress: '0x21594b992F68495dD28d605834b58889d0a727c7',
    token0: TOKENS.VIRTUAL,
    token1: TOKENS.WETH,
    meta: { stable: false }
  },
  {
    dex: 'uniswap_v2',
    pairAddress: '0xE31c372a7Af875b3B5E0F3713B17ef51556da667',
    token0: TOKENS.VIRTUAL,
    token1: TOKENS.WETH
  },
  {
    dex: 'uniswap_v3',
    pairAddress: '0x1D4daB3f27C7F656b6323C1D6Ef713b48A8f72F1',
    token0: TOKENS.VIRTUAL,
    token1: TOKENS.WETH,
    meta: { feeTiers: [100, 500, 3000, 10000] }
  },
  {
    dex: 'uniswap_v3',
    pairAddress: '0x529d2863a1521d0b57db028168fdE2E97120017C',
    token0: TOKENS.VIRTUAL,
    token1: TOKENS.USDC,
    meta: { feeTiers: [100, 500, 3000, 10000] }
  }
];

// ==================== DYNAMIC PAIR GENERATION ====================
function generatePairs() {
  const pairs = [];
  const tokenList = Object.keys(TOKENS);
  const stablecoins = ['USDC', 'USDT', 'DAI'];

  for (const tName of tokenList) {
    // vs stablecoins
    for (const sName of stablecoins) {
      pairs.push({
        t0: TOKENS[tName],
        t1: TOKENS[sName],
        dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'],
        meta: { feeTiers: [100, 500, 3000, 10000] }
      });
    }
    // vs WETH
    pairs.push({
      t0: TOKENS[tName],
      t1: TOKENS.WETH,
      dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'],
      meta: { feeTiers: [100, 500, 3000, 10000] }
    });
  }
  return pairs;
}

const VERIFIED_PAIRS = generatePairs();

// ==================== PRICE & LIQUIDITY FETCHER ====================
class PriceFetcher {
  constructor() {
    this.quoterV3 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_QUOTER, UNISWAP_V3_QUOTER_ABI, provider);
    this.routerV2 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_ABI, provider);
    this.aerodromeRouter = new ethers.Contract(DEX_ADDRESSES.AERODROME_ROUTER, AERODROME_ROUTER_ABI, provider);

    this.v3Factory = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_FACTORY, UNISWAP_V3_FACTORY_ABI, provider);
    this.v2Factory = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V2_FACTORY, UNISWAP_V2_FACTORY_ABI, provider);
    this.aeroFactory = new ethers.Contract(DEX_ADDRESSES.AERODROME_FACTORY, AERODROME_FACTORY_ABI, provider);
  }

  async getLiquidityUSD(token0, token1, dexType) {
    try {
      let poolAddress = ethers.constants.AddressZero;
      if (dexType === 'uniswap_v3') {
        // Use common tier for existence check; liquidity calc uses token0 balance only (approx)
        poolAddress = await this.v3Factory.getPool(token0.address, token1.address, 3000);
      } else if (dexType === 'uniswap_v2') {
        poolAddress = await this.v2Factory.getPair(token0.address, token1.address);
      } else if (dexType === 'aerodrome') {
        poolAddress = await this.aeroFactory.getPool(token0.address, token1.address, false);
      }
      if (poolAddress === ethers.constants.AddressZero) return 0;

      const t0Contract = new ethers.Contract(token0.address, ERC20_ABI, provider);
      const bal0 = await t0Contract.balanceOf(poolAddress);
      if (bal0.isZero()) return 0;

      const balanceFormatted = parseFloat(ethers.utils.formatUnits(bal0, token0.decimals));
      const price = TOKEN_PRICES_USD[token0.name] || 1;
      return balanceFormatted * price;
    } catch {
      return 0;
    }
  }

  async getPrice(token0, token1, dexType, tradeSize, meta = {}) {
    const amountIn = ethers.utils.parseUnits(tradeSize, token0.decimals);
    try {
      if (dexType === 'uniswap_v3') {
        const feeTiers = meta?.feeTiers || [500]; // default 0.05% if not specified
        const results = {};
        for (const fee of feeTiers) {
          const out = await this.quoterV3.callStatic.quoteExactInputSingle(
            token0.address,
            token1.address,
            fee,
            amountIn,
            0
          );
          results[fee] = out;
        }
        return results; // object keyed by fee tier
      } else if (dexType === 'uniswap_v2') {
        const amounts = await this.routerV2.getAmountsOut(amountIn, [token0.address, token1.address]);
        return amounts[1];
      } else if (dexType === 'aerodrome') {
        const routes = [{ from: token0.address, to: token1.address, stable: false, factory: DEX_ADDRESSES.AERODROME_FACTORY }];
        const amounts = await this.aerodromeRouter.getAmountsOut(amountIn, routes);
        return amounts[1];
      }
    } catch {
      return null;
    }
    return null;
  }
}

// ==================== ARBITRAGE DETECTOR ====================
class ArbitrageDetector {
  constructor() {
    this.prices = new PriceFetcher();
  }

  async getSpreadData(pair) {
    const priceData = {};
    const liquidityData = {};

    // STEP 1: CHECK LIQUIDITY IN USD FIRST
    for (const dex of pair.dexes || [pair.dex]) {
      const liquidityUSD = await this.prices.getLiquidityUSD(pair.t0 || pair.token0, pair.t1 || pair.token1, dex);
      liquidityData[dex] = liquidityUSD;

      if (liquidityUSD < CONFIG.MIN_LIQUIDITY_USD) continue;

      // STEP 2: QUERY PRICES ONLY IF LIQUIDITY ABOVE THRESHOLD
      const price = await this.prices.getPrice(
        pair.t0 || pair.token0,
        pair.t1 || pair.token1,
        dex,
        CONFIG.TRADE_SIZE,
        pair.meta || {}
      );

      if (!price) continue;

      if (dex === 'uniswap_v3' && typeof price === 'object') {
        for (const [fee, out] of Object.entries(price)) {
          if (out && out.gt(0)) priceData[`${dex}_${fee}`] = out;
        }
      } else if (price.gt && price.gt(0)) {
        priceData[dex] = price;
      }
    }

    const dexNames = Object.keys(priceData);
    if (dexNames.length < 2) return null;

    // STEP 3: CALCULATE SPREAD
    let bestBuyDex = null, bestBuyPrice = ethers.BigNumber.from(0); // max out
    let bestSellDex = null, bestSellPrice = ethers.constants.MaxUint256; // min out

    for (const dex of dexNames) {
      const price = priceData[dex];
      if (price.gt(bestBuyPrice)) { bestBuyPrice = price; bestBuyDex = dex; }
      if (price.lt(bestSellPrice)) { bestSellPrice = price; bestSellDex = dex; }
    }

    const pBuy = parseFloat(ethers.utils.formatUnits(bestBuyPrice, (pair.t1 || pair.token1).decimals));
    const pSell = parseFloat(ethers.utils.formatUnits(bestSellPrice, (pair.t1 || pair.token1).decimals));
    const diff = pSell > 0 ? ((pBuy - pSell) / pSell) * 100 : 0;

    return {
      diff,
      bestBuyDex,
      bestSellDex,
      pBuy,
      pSell,
      liquidityData,
      liquidDexes: dexNames
    };
  }

  async scan() {
    const allPairs = [...VERIFIED_PAIRS, ...VIRTUAL_POOLS];

    console.log(`\n[${new Date().toISOString()}] Scanning ${allPairs.length} pairs (dynamic + explicit VIRTUAL)...`);
    let opportunitiesFound = 0;

    for (const pair of allPairs) {
      const firstCheck = await this.getSpreadData(pair);
      if (!firstCheck || firstCheck.diff < CONFIG.PRICE_DIFFERENCE_THRESHOLD) continue;

      const baseLabel = `${(pair.t0 || pair.token0).name}/${(pair.t1 || pair.token1).name}`;
      console.log(`🔍 Potential opportunity: ${baseLabel} | Spread=${firstCheck.diff.toFixed(2)}% | Liquid DEXes: ${firstCheck.liquidDexes.join(', ')} | Double checking...`);

      // Double-check after short delay
      await new Promise(resolve => setTimeout(resolve, 500));
      const secondCheck = await this.getSpreadData(pair);

      if (secondCheck && secondCheck.diff >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
        opportunitiesFound++;
        const msg = `🎯 VERIFIED: ${baseLabel} | Profit=${secondCheck.diff.toFixed(2)}% | Buy on ${secondCheck.bestSellDex} ($${secondCheck.pSell.toFixed(6)}), Sell on ${secondCheck.bestBuyDex} ($${secondCheck.pBuy.toFixed(6)})`;
        console.log(msg);
        if (CONFIG.WEBHOOK_URL) {
          axios.post(CONFIG.WEBHOOK_URL, { content: msg }).catch(() => {});
        }
      } else {
        console.log(`❌ Dropped: ${baseLabel} | Spread decayed or liquidity < $${CONFIG.MIN_LIQUIDITY_USD}.`);
      }
    }

    console.log(`✓ Scan complete. Found ${opportunitiesFound} verified opportunities.\n`);
  }
}

// ==================== EXECUTION ====================
async function main() {
  const detector = new ArbitrageDetector();
  await detector.scan();
  setInterval(() => detector.scan(), CONFIG.CHECK_INTERVAL_MS);

  // Simple health check server
  const http = require('http');
  const port = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Arbitrage Bot running: multi-fee Uniswap V3 + explicit VIRTUAL pools + double-check logic.\n');
  }).listen(port, () => console.log(`Health check server on port ${port}`));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
