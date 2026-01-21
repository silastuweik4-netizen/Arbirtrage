// detector.js
const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const CONFIG = {
  BASE_CHAIN_ID: 8453,
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  PRICE_DIFFERENCE_THRESHOLD: parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD) || 1.0, // %
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS) || 10000,
  WEBHOOK_URL: process.env.WEBHOOK_URL || null,
  TRADE_SIZE: process.env.TRADE_SIZE || '1', // default fallback in token0 units
  MIN_LIQUIDITY_USD: parseInt(process.env.MIN_LIQUIDITY_USD) || 3000,
  PORT: parseInt(process.env.PORT || '3000'),
};

// ==================== EXECUTION CONFIG HELPERS ====================
function parseJSONEnv(key, fallback) {
  try { return JSON.parse(process.env[key] || JSON.stringify(fallback)); }
  catch { return fallback; }
}

const TRADE_SIZES = parseJSONEnv('TRADE_SIZES_JSON', { DEFAULT: '1', AERO: '500', msETH: '0.2', cbETH: '0.2' });
const SLIPPAGE_CAPS = parseJSONEnv('SLIPPAGE_CAPS_JSON', { DEFAULT: 1.0, AERO: 2.0, msETH: 1.0, cbETH: 1.0 });
const MIN_LIQUIDITY_PER_DEX = parseJSONEnv('MIN_LIQUIDITY_PER_DEX_JSON', { aerodrome: 2000, uniswap_v3: 3000, uniswap_v2: 3000 });
const FEE_ASSUMPTIONS = parseJSONEnv('FEE_ASSUMPTIONS_JSON', {
  uniswap_v3_100: 0.01, uniswap_v3_500: 0.05, uniswap_v3_3000: 0.30, uniswap_v3_10000: 1.00,
  uniswap_v3: 0.30, uniswap_v2: 0.30, aerodrome: 0.20
});
const MIN_NET_PROFIT_PCT = parseFloat(process.env.MIN_NET_PROFIT_PCT || '0.5');
const GAS_USD_ESTIMATE = parseFloat(process.env.GAS_USD_ESTIMATE || '0.10');

function getTradeSize(symbol) { return TRADE_SIZES[symbol] || TRADE_SIZES.DEFAULT; }
function getSlippageCap(symbol) { return SLIPPAGE_CAPS[symbol] || SLIPPAGE_CAPS.DEFAULT; }

// ==================== PROVIDER ====================
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
  USDbC: 1,
  VIRTUAL: 5,
  AERO: 0.25,
  msETH: 2500,
  cbETH: 2500,
};

// ==================== VERIFIED TOKENS ====================
const TOKENS = {
  WETH:   { address: '0x4200000000000000000000000000000000000006', name: 'WETH',   decimals: 18 },
  USDC:   { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'USDC',   decimals: 6 },
  USDbC:  { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', name: 'USDbC',  decimals: 6 },
  VIRTUAL:{ address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', name: 'VIRTUAL',decimals: 18 },
  AERO:   { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', name: 'AERO',   decimals: 18 },
  msETH:  { address: '0x7Ba6F01772924a82D9626c126347A28299E98c98', name: 'msETH',  decimals: 18 },
  cbETH:  { address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', name: 'cbETH',  decimals: 18 },
};

// ==================== EXPLICIT POOLS ====================
const VIRTUAL_POOLS = [
  { dex: 'aerodrome',  pairAddress: '0x21594b992F68495dD28d605834b58889d0a727c7', token0: TOKENS.VIRTUAL, token1: TOKENS.WETH,  meta: { stable: false } },
  { dex: 'uniswap_v2', pairAddress: '0xE31c372a7Af875b3B5E0F3713B17ef51556da667', token0: TOKENS.VIRTUAL, token1: TOKENS.WETH },
  { dex: 'uniswap_v3', pairAddress: '0x1D4daB3f27C7F656b6323C1D6Ef713b48A8f72F1', token0: TOKENS.VIRTUAL, token1: TOKENS.WETH,  meta: { feeTiers: [100, 500, 3000, 10000] } },
  { dex: 'uniswap_v3', pairAddress: '0x529d2863a1521d0b57db028168fdE2E97120017C', token0: TOKENS.VIRTUAL, token1: TOKENS.USDC, meta: { feeTiers: [100, 500, 3000, 10000] } }
];

const AERO_POOLS = [
  { dex: 'uniswap_v3', pairAddress: '0xE5B5f522E98B5a2baAe212d4dA66b865B781DB97', token0: TOKENS.AERO, token1: TOKENS.USDC, meta: { feeTiers: [100, 500, 3000, 10000] } },
  { dex: 'aerodrome', pairAddress: '0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d', token0: TOKENS.AERO, token1: TOKENS.USDC, meta: { stable: false } }
];

const AERO_USDbC_POOL = {
  dex: 'aerodrome',
  pairAddress: '0x2223F9FE624F69Da4D8256A7bCc9104FBA7F8f75',
  token0: TOKENS.AERO,
  token1: TOKENS.USDbC,
  meta: { stable: false }
};

const msETH_WETH_AERODROME = {
  dex: 'aerodrome',
  pairAddress: '0xDE4FB30cCC2f1210FcE2c8aD66410C586C8D1f9A',
  token0: TOKENS.msETH,
  token1: TOKENS.WETH,
  meta: { stable: false }
};

const msETH_WETH_SLIPSTREAM = {
  dex: 'aerodrome',
  pairAddress: '0x74F72788F4814D7fF3C49B44684aa98Eee140C0E',
  token0: TOKENS.msETH,
  token1: TOKENS.WETH,
  meta: { stable: false }
};

const cbETH_WETH_SLIPSTREAM = {
  dex: 'aerodrome',
  pairAddress: '0x47cA96Ea59C13F72745928887f84C9F52C3D7348',
  token0: TOKENS.cbETH,
  token1: TOKENS.WETH,
  meta: { stable: false }
};

// Grouped WETH-derivative pools (like VIRTUAL_POOLS style)
const WETH_DERIVATIVE_POOLS = [
  msETH_WETH_AERODROME,
  msETH_WETH_SLIPSTREAM,
  cbETH_WETH_SLIPSTREAM
];

// ==================== TRIANGULAR ROUTES ====================
const TRIANGULAR_ROUTES = [
  // VIRTUAL routes
  {
    label: 'VIRTUAL-WETH-USDC',
    legs: [
      { tokenIn: TOKENS.VIRTUAL, tokenOut: TOKENS.WETH,  meta: { feeTiers:[100,500,3000,10000]} },
      { tokenIn: TOKENS.WETH,    tokenOut: TOKENS.USDC,  meta: { feeTiers:[100,500,3000,10000]} }
    ],
    direct: { tokenIn: TOKENS.VIRTUAL, tokenOut: TOKENS.USDC, meta: { feeTiers:[100,500,3000,10000]} }
  },
  // AERO routes with USDC
  {
    label: 'AERO-WETH-USDC',
    legs: [
      { tokenIn: TOKENS.AERO, tokenOut: TOKENS.WETH,  meta: { feeTiers:[100,500,3000,10000]} },
      { tokenIn: TOKENS.WETH, tokenOut: TOKENS.USDC,  meta: { feeTiers:[100,500,3000,10000]} }
    ],
    direct: { tokenIn: TOKENS.AERO, tokenOut: TOKENS.USDC, meta: { feeTiers:[100,500,3000,10000]} }
  },
  // AERO routes with USDbC
  {
    label: 'AERO-USDbC-WETH',
    legs: [
      { tokenIn: TOKENS.AERO,  tokenOut: TOKENS.USDbC, meta: { feeTiers:[100,500,3000,10000]} },
      { tokenIn: TOKENS.USDbC, tokenOut: TOKENS.WETH,  meta: { feeTiers:[100,500,3000,10000]} }
    ],
    direct: { tokenIn: TOKENS.AERO, tokenOut: TOKENS.WETH, meta: { feeTiers:[100,500,3000,10000]} }
  },
  {
    label: 'AERO-WETH-USDbC',
    legs: [
      { tokenIn: TOKENS.AERO, tokenOut: TOKENS.WETH,   meta: { feeTiers:[100,500,3000,10000]} },
      { tokenIn: TOKENS.WETH, tokenOut: TOKENS.USDbC,  meta: { feeTiers:[100,500,3000,10000]} }
    ],
    direct: { tokenIn: TOKENS.AERO, tokenOut: TOKENS.USDbC, meta: { feeTiers:[100,500,3000,10000]} }
  },
  // msETH/cbETH explicit triangulars
  {
    label: 'msETH-WETH-USDC',
    legs: [
      { tokenIn: TOKENS.msETH, tokenOut: TOKENS.WETH,  meta: { feeTiers:[100,500,3000,10000]} },
      { tokenIn: TOKENS.WETH,  tokenOut: TOKENS.USDC,  meta: { feeTiers:[100,500,3000,10000]} }
    ],
    direct: { tokenIn: TOKENS.msETH, tokenOut: TOKENS.USDC, meta: { feeTiers:[100,500,3000,10000]} }
  },
  {
    label: 'cbETH-WETH-USDbC',
    legs: [
      { tokenIn: TOKENS.cbETH, tokenOut: TOKENS.WETH,  meta: { feeTiers:[100,500,3000,10000]} },
      { tokenIn: TOKENS.WETH,  tokenOut: TOKENS.USDbC, meta: { feeTiers:[100,500,3000,10000]} }
    ],
    direct: { tokenIn: TOKENS.cbETH, tokenOut: TOKENS.USDbC, meta: { feeTiers:[100,500,3000,10000]} }
  }
];

// ==================== DYNAMIC PAIR GENERATION ====================
function generatePairs() {
  const pairs = [];
  const tokenList = Object.keys(TOKENS);
  const stablecoins = ['USDC', 'USDbC'];

  for (const tName of tokenList) {
    for (const sName of stablecoins) {
      if (tName === sName) continue;
      pairs.push({
        t0: TOKENS[tName],
        t1: TOKENS[sName],
        dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'],
        meta: { feeTiers: [100, 500, 3000, 10000] }
      });
    }
    if (tName !== 'WETH') {
      pairs.push({
        t0: TOKENS[tName],
        t1: TOKENS.WETH,
        dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'],
        meta: { feeTiers: [100, 500, 3000, 10000] }
      });
    }
  }
  return pairs;
}

const VERIFIED_PAIRS = generatePairs();

// ==================== UTILS ====================
function parseVenueTag(tag) {
  if (!tag) return 'aerodrome';
  if (tag.startsWith('uniswap_v3')) return 'uniswap_v3';
  if (tag.startsWith('uniswap_v2')) return 'uniswap_v2';
  return 'aerodrome';
}
function toFloat(bnOrNumber, decimals) {
  if (!bnOrNumber) return 0;
  if (typeof bnOrNumber === 'number') return bnOrNumber;
  return parseFloat(ethers.utils.formatUnits(bnOrNumber, decimals));
}
function estimateFeesPct(buyVenueTag, sellVenueTag) {
  const buyFee = FEE_ASSUMPTIONS[buyVenueTag] ?? FEE_ASSUMPTIONS[parseVenueTag(buyVenueTag)] ?? 0.30;
  const sellFee = FEE_ASSUMPTIONS[sellVenueTag] ?? FEE_ASSUMPTIONS[parseVenueTag(sellVenueTag)] ?? 0.30;
  return buyFee + sellFee; // %
}
function notionalUSD(tokenOutSymbol, amountOut) {
  const px = TOKEN_PRICES_USD[tokenOutSymbol] || 1;
  return amountOut * px;
}
function estimateGasPctUSD(notionalUSDVal) {
  if (notionalUSDVal <= 0) return 0;
  return (GAS_USD_ESTIMATE / notionalUSDVal) * 100;
}

// ==================== PRICE & LIQUIDITY FETCHER ====================
class PriceFetcher {
  constructor() {
    this.quoterV3     = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_QUOTER, UNISWAP_V3_QUOTER_ABI, provider);
    this.routerV2     = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_ABI, provider);
    this.aeroRouter   = new ethers.Contract(DEX_ADDRESSES.AERODROME_ROUTER,  AERODROME_ROUTER_ABI,  provider);

    this.v3Factory    = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_FACTORY, UNISWAP_V3_FACTORY_ABI, provider);
    this.v2Factory    = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V2_FACTORY, UNISWAP_V2_FACTORY_ABI, provider);
    this.aeroFactory  = new ethers.Contract(DEX_ADDRESSES.AERODROME_FACTORY,  AERODROME_FACTORY_ABI,  provider);
  }

  async getLiquidityUSD(token0, token1, dexType) {
    try {
      let poolAddress = ethers.constants.AddressZero;
      if (dexType === 'uniswap_v3') {
        poolAddress = await this.v3Factory.getPool(token0.address, token1.address, 3000);
      } else if (dexType === 'uniswap_v2') {
        poolAddress = await this.v2Factory.getPair(token0.address, token1.address);
      } else if (dexType === 'aerodrome') {
        poolAddress = await this.aeroFactory.getPool(token0.address, token1.address, false);
      }
      if (!poolAddress || poolAddress === ethers.constants.AddressZero) return 0;

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
    const amountIn = ethers.utils.parseUnits(String(tradeSize), token0.decimals);
    try {
      if (dexType === 'uniswap_v3') {
        const feeTiers = meta?.feeTiers || [500];
        const results = {};
        for (const fee of feeTiers) {
          const out = await this.quoterV3.callStatic.quoteExactInputSingle(
            token0.address, token1.address, fee, amountIn, 0
          );
          results[fee] = out;
        }
        return results; // object keyed by fee tier
      } else if (dexType === 'uniswap_v2') {
        const amounts = await this.routerV2.getAmountsOut(amountIn, [token0.address, token1.address]);
        return amounts[1];
      } else if (dexType === 'aerodrome') {
        const routes = [{ from: token0.address, to: token1.address, stable: false, factory: DEX_ADDRESSES.AERODROME_FACTORY }];
        const amounts = await this.aeroRouter.getAmountsOut(amountIn, routes);
        return amounts[1];
      }
    } catch {
      return null;
    }
    return null;
  }

  async getBestQuote(tokenIn, tokenOut, tradeSize, meta = {}) {
    const venues = ['uniswap_v3','uniswap_v2','aerodrome'];
    let bestOut = 0;
    let bestVenue = null;

    for (const dex of venues) {
      const quote = await this.getPrice(tokenIn, tokenOut, dex, tradeSize, meta);
      if (!quote) continue;

      if (dex === 'uniswap_v3' && typeof quote === 'object') {
        for (const [fee, out] of Object.entries(quote)) {
          const val = parseFloat(ethers.utils.formatUnits(out, tokenOut.decimals));
          if (val > bestOut) { bestOut = val; bestVenue = `${dex}_${fee}`; }
        }
      } else {
        const val = parseFloat(ethers.utils.formatUnits(quote, tokenOut.decimals));
        if (val > bestOut) { bestOut = val; bestVenue = dex; }
      }
    }

    return { bestOut, bestVenue };
  }
}

// ==================== EXECUTOR (STUB) ====================
class ArbExecutor {
  async atomicTwoLegSwap({ buyVenue, sellVenue, tokenIn, tokenOut, amountIn, minBuyOut, minSellOut }) {
    console.log(`EXECUTE atomicTwoLegSwap | buy=${buyVenue} sell=${sellVenue} in=${tokenIn.name} out=${tokenOut.name} amount=${amountIn} minBuyOut=${minBuyOut.toFixed(6)} minSellOut=${minSellOut.toFixed(6)}`);
    // TODO: wire actual router/contract calls here
    return true;
  }
}

// ==================== ARBITRAGE DETECTOR ====================
class ArbitrageDetector {
  constructor() { this.prices = new PriceFetcher(); }

  async getSpreadData(pair) {
    const priceData = {};
    const liquidityData = {};

    for (const dex of pair.dexes || [pair.dex]) {
      const liquidityUSD = await this.prices.getLiquidityUSD(pair.t0 || pair.token0, pair.t1 || pair.token1, dex);
      liquidityData[dex] = liquidityUSD;
      if (liquidityUSD < CONFIG.MIN_LIQUIDITY_USD) continue;

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
      } else if (price?.gt && price.gt(0)) {
        priceData[dex] = price;
      }
    }

    const dexNames = Object.keys(priceData);
    if (dexNames.length < 2) return null;

    let bestBuyDex = null, bestBuyPrice = ethers.BigNumber.from(0);
    let bestSellDex = null, bestSellPrice = ethers.constants.MaxUint256;

    for (const dex of dexNames) {
      const price = priceData[dex];
      if (price.gt(bestBuyPrice)) { bestBuyPrice = price; bestBuyDex = dex; }
      if (price.lt(bestSellPrice)) { bestSellPrice = price; bestSellDex = dex; }
    }

    const pBuy  = parseFloat(ethers.utils.formatUnits(bestBuyPrice,  (pair.t1 || pair.token1).decimals));
    const pSell = parseFloat(ethers.utils.formatUnits(bestSellPrice, (pair.t1 || pair.token1).decimals));
    const diff  = pSell > 0 ? ((pBuy - pSell) / pSell) * 100 : 0;

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

  async evaluateTriangularBest(route) {
    const tradeSize = CONFIG.TRADE_SIZE;

    const leg1 = await this.prices.getBestQuote(route.legs[0].tokenIn, route.legs[0].tokenOut, tradeSize, route.legs[0].meta);
    if (!leg1.bestOut) return null;

    const leg2 = await this.prices.getBestQuote(route.legs[1].tokenIn, route.legs[1].tokenOut, tradeSize, route.legs[1].meta);
    if (!leg2.bestOut) return null;

    const composite = leg1.bestOut * leg2.bestOut;

    const direct = await this.prices.getBestQuote(route.direct.tokenIn, route.direct.tokenOut, tradeSize, route.direct.meta);
    if (!direct.bestOut) return null;

    const diff = direct.bestOut > 0 ? ((composite - direct.bestOut) / direct.bestOut) * 100 : 0;

    return {
      composite,
      direct: direct.bestOut,
      diff,
      leg1Venue: leg1.bestVenue,
      leg2Venue: leg2.bestVenue,
      directVenue: direct.bestVenue
    };
  }

  async scan() {
    const executor = new ArbExecutor();

    const allPairs  = [
      ...VERIFIED_PAIRS,
      ...VIRTUAL_POOLS,
      ...AERO_POOLS,
      AERO_USDbC_POOL,
      ...WETH_DERIVATIVE_POOLS
    ];
    const allRoutes = [...TRIANGULAR_ROUTES];

    console.log(`\n[${new Date().toISOString()}] Scanning ${allPairs.length} pairs & ${allRoutes.length} triangular routes...`);
    let opportunitiesFound = 0;

    // Direct pairs
    for (const pair of allPairs) {
      const firstCheck = await this.getSpreadData(pair);
      if (!firstCheck || firstCheck.diff < CONFIG.PRICE_DIFFERENCE_THRESHOLD) continue;

      const baseLabel = `${(pair.t0 || pair.token0).name}/${(pair.t1 || pair.token1).name}`;
      console.log(`🔍 Potential: ${baseLabel} | Spread=${firstCheck.diff.toFixed(2)}% | Liquid DEXes: ${firstCheck.liquidDexes.join(', ')} | Double checking...`);

      await new Promise(resolve => setTimeout(resolve, 500));
      const secondCheck = await this.getSpreadData(pair);

      if (secondCheck && secondCheck.diff >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
        opportunitiesFound++;
        const msg = `🎯 VERIFIED: ${baseLabel} | Profit=${secondCheck.diff.toFixed(2)}% | Buy on ${secondCheck.bestSellDex} ($${secondCheck.pSell.toFixed(6)}), Sell on ${secondCheck.bestBuyDex} ($${secondCheck.pBuy.toFixed(6)})`;
        console.log(msg);
        if (CONFIG.WEBHOOK_URL) axios.post(CONFIG.WEBHOOK_URL, { content: msg }).catch(() => {});

        // Execute with guardrails
        await executeIfProfitable(pair, this, executor);
      } else {
        console.log(`❌ Dropped: ${baseLabel} | Spread decayed or liquidity < $${CONFIG.MIN_LIQUIDITY_USD}.`);
      }
    }

    // Triangular routes (best-of-venues per leg)
    for (const route of allRoutes) {
      const first = await this.evaluateTriangularBest(route);
      if (!first || first.diff < CONFIG.PRICE_DIFFERENCE_THRESHOLD) continue;

      console.log(`🔺 Triangular potential: ${route.label} | Spread=${first.diff.toFixed(2)}% | Composite=${first.composite.toFixed(6)} vs Direct=${first.direct.toFixed(6)} | Venues: ${first.leg1Venue} + ${first.leg2Venue} vs ${first.directVenue} | Double checking...`);
      await new Promise(resolve => setTimeout(resolve, 500));
      const second = await this.evaluateTriangularBest(route);

      if (second && second.diff >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
        opportunitiesFound++;
        const msg = `🎯 TRIANGULAR VERIFIED: ${route.label} | Profit=${second.diff.toFixed(2)}% | Composite=${second.composite.toFixed(6)} vs Direct=${second.direct.toFixed(6)} | Venues: ${second.leg1Venue} + ${second.leg2Venue} vs ${second.directVenue}`;
        console.log(msg);
        if (CONFIG.WEBHOOK_URL) axios.post(CONFIG.WEBHOOK_URL, { content: msg }).catch(() => {});
        // Triangular execution path would require multi-leg atomic contract; omitted here.
      } else {
        console.log(`❌ Triangular dropped: ${route.label} | Spread decayed below ${CONFIG.PRICE_DIFFERENCE_THRESHOLD}%`);
      }
    }

    console.log(`✓ Scan complete. Found ${opportunitiesFound} verified opportunities.\n`);
  }
}

// ==================== PROFIT EXECUTION PATH ====================
async function executeIfProfitable(pair, detector, executor) {
  const firstCheck = await detector.getSpreadData(pair);
  if (!firstCheck) return;

  // Per-dex liquidity minimums
  for (const [dex, usd] of Object.entries(firstCheck.liquidityData || {})) {
    const minDex = MIN_LIQUIDITY_PER_DEX[dex] || 0;
    if (usd < minDex) return;
  }

  await new Promise(r => setTimeout(r, 500));
  const secondCheck = await detector.getSpreadData(pair);
  if (!secondCheck || secondCheck.diff < CONFIG.PRICE_DIFFERENCE_THRESHOLD) return;

  const tokenIn  = pair.t0 || pair.token0;
  const tokenOut = pair.t1 || pair.token1;

  const tradeSize = getTradeSize(tokenIn.name);
  const buyVenueTag  = secondCheck.bestSellDex; // lower price venue
  const sellVenueTag = secondCheck.bestBuyDex;  // higher price venue

  const buyQuoteRaw  = await detector.prices.getPrice(tokenIn, tokenOut, parseVenueTag(buyVenueTag), tradeSize, pair.meta || {});
  const sellQuoteRaw = await detector.prices.getPrice(tokenIn, tokenOut, parseVenueTag(sellVenueTag), tradeSize, pair.meta || {});
  if (!buyQuoteRaw || !sellQuoteRaw) return;

  let buyOut = 0, sellOut = 0;
  if (buyVenueTag.startsWith('uniswap_v3') && typeof buyQuoteRaw === 'object') {
    const fee = buyVenueTag.split('_')[2] || '500';
    buyOut = toFloat(buyQuoteRaw[fee], tokenOut.decimals);
  } else {
    buyOut = toFloat(buyQuoteRaw, tokenOut.decimals);
  }
  if (sellVenueTag.startsWith('uniswap_v3') && typeof sellQuoteRaw === 'object') {
    const fee = sellVenueTag.split('_')[2] || '500';
    sellOut = toFloat(sellQuoteRaw[fee], tokenOut.decimals);
  } else {
    sellOut = toFloat(sellQuoteRaw, tokenOut.decimals);
  }
  if (buyOut <= 0 || sellOut <= 0) return;

  const spreadPct = buyOut > 0 ? ((sellOut - buyOut) / buyOut) * 100 : 0;

  const slipBuyPct  = secondCheck.pSell > 0 ? ((secondCheck.pSell - buyOut) / secondCheck.pSell) * 100 : 0;
  const slipSellPct = secondCheck.pBuy  > 0 ? ((secondCheck.pBuy  - sellOut) / secondCheck.pBuy)  * 100 : 0;
  const slipTotalPct = Math.max(0, slipBuyPct) + Math.max(0, slipSellPct);

  const feesPct = estimateFeesPct(buyVenueTag, sellVenueTag);
  const notional = notionalUSD(tokenOut.name, buyOut);
  const gasPct = estimateGasPctUSD(notional);

  const netPct = spreadPct - feesPct - slipTotalPct - gasPct;
  if (netPct < MIN_NET_PROFIT_PCT) return;

  const cap = getSlippageCap(tokenIn.name);
  const minBuyOut = buyOut * (1 - cap / 100);
  const minSellOut = sellOut * (1 - cap / 100);

  await executor.atomicTwoLegSwap({
    buyVenue: buyVenueTag,
    sellVenue: sellVenueTag,
    tokenIn,
    tokenOut,
    amountIn: tradeSize,
    minBuyOut,
    minSellOut
  });

  const pairLabel = `${tokenIn.name}/${tokenOut.name}`;
  console.log(`EXECUTED ${pairLabel} | net=${netPct.toFixed(2)}% | spread=${spreadPct.toFixed(2)}% | fees=${feesPct.toFixed(2)}% | slip=${slipTotalPct.toFixed(2)}% | gas=${gasPct.toFixed(2)}% | buy=${buyVenueTag} $${buyOut.toFixed(6)} -> sell=${sellVenueTag} $${sellOut.toFixed(6)}`);
}

// ==================== EXECUTION ====================
async function main() {
  const detector = new ArbitrageDetector();
  await detector.scan();
  setInterval(() => detector.scan(), CONFIG.CHECK_INTERVAL_MS);

  // Health check server
  const http = require('http');
  http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Arbitrage Bot running: Uniswap V2/V3 + Aerodrome + explicit VIRTUAL/AERO + AERO/USDbC + msETH/cbETH + triangular best-of-venues + execution guardrails.\n');
  }).listen(CONFIG.PORT, () => console.log(`Health check server on port ${CONFIG.PORT}`));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
