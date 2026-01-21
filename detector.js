// detector.js
const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();
const ArbExecutor = require('./arbexecutor');   // ✅ use real executor

// ==================== CONFIGURATION ====================
const CONFIG = {
  BASE_CHAIN_ID: 8453,
  RPC_URL: process.env.RPC_URL, // Alchemy MEV-protected RPC
  PRICE_DIFFERENCE_THRESHOLD: parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD) || 1.0,
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS) || 10000,
  WEBHOOK_URL: process.env.WEBHOOK_URL || null,
  TRADE_SIZE: process.env.TRADE_SIZE || '1',
  MIN_LIQUIDITY_USD: parseInt(process.env.MIN_LIQUIDITY_USD) || 3000,
  PORT: parseInt(process.env.PORT || '3000'),
};

const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== TOKEN PRICES (USD) ====================
const TOKEN_PRICES_USD = {
  WETH: 2500, USDC: 1, USDbC: 1, VIRTUAL: 5, AERO: 0.25, msETH: 2500, cbETH: 2500,
};

// ==================== TOKENS ====================
const TOKENS = {
  WETH:   { address: '0x4200000000000000000000000000000000000006', name: 'WETH',   decimals: 18 },
  USDC:   { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'USDC',   decimals: 6 },
  USDbC:  { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', name: 'USDbC',  decimals: 6 },
  VIRTUAL:{ address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', name: 'VIRTUAL',decimals: 18 },
  AERO:   { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', name: 'AERO',   decimals: 18 },
  msETH:  { address: '0x7Ba6F01772924a82D9626c126347A28299E98c98', name: 'msETH',  decimals: 18 },
  cbETH:  { address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', name: 'cbETH',  decimals: 18 },
};

// ==================== POOLS ====================
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

const WETH_DERIVATIVE_POOLS = [
  msETH_WETH_AERODROME,
  msETH_WETH_SLIPSTREAM,
  cbETH_WETH_SLIPSTREAM
];

// ==================== TRIANGULAR ROUTES ====================
const TRIANGULAR_ROUTES = [
  { label: 'VIRTUAL-WETH-USDC', legs: [ { tokenIn: TOKENS.VIRTUAL, tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH, tokenOut: TOKENS.USDC } ], direct: { tokenIn: TOKENS.VIRTUAL, tokenOut: TOKENS.USDC } },
  { label: 'AERO-WETH-USDC', legs: [ { tokenIn: TOKENS.AERO, tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH, tokenOut: TOKENS.USDC } ], direct: { tokenIn: TOKENS.AERO, tokenOut: TOKENS.USDC } },
  { label: 'AERO-USDbC-WETH', legs: [ { tokenIn: TOKENS.AERO, tokenOut: TOKENS.USDbC }, { tokenIn: TOKENS.USDbC, tokenOut: TOKENS.WETH } ], direct: { tokenIn: TOKENS.AERO, tokenOut: TOKENS.WETH } },
  { label: 'AERO-WETH-USDbC', legs: [ { tokenIn: TOKENS.AERO, tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH, tokenOut: TOKENS.USDbC } ], direct: { tokenIn: TOKENS.AERO, tokenOut: TOKENS.USDbC } },
  { label: 'msETH-WETH-USDC', legs: [ { tokenIn: TOKENS.msETH, tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH, tokenOut: TOKENS.USDC } ], direct: { tokenIn: TOKENS.msETH, tokenOut: TOKENS.USDC } },
  { label: 'cbETH-WETH-USDC', legs: [ { tokenIn: TOKENS.cbETH, tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH, tokenOut: TOKENS.USDC } ], direct: { tokenIn: TOKENS.cbETH, tokenOut: TOKENS.USDC } }
];

// ==================== PRICE FETCHER ====================
class PriceFetcher {
  async getQuote(pool, amountIn) {
    // Simplified stub: in production you’d query router contracts
    const priceIn = TOKEN_PRICES_USD[pool.token0.name] || 1;
    const priceOut = TOKEN_PRICES_USD[pool.token1.name] || 1;
    const outAmount = (amountIn * priceIn) / priceOut;
    return { amountOut: outAmount, liquidityUSD: amountIn * priceIn };
  }
}

// ==================== ARBITRAGE DETECTOR ====================
class ArbitrageDetector {
  constructor() {
    this.prices = new PriceFetcher();
  }

  async getSpreadData(pool) {
    const tradeSize = parseFloat(CONFIG.TRADE_SIZE);
    const quote = await this.prices.getQuote(pool, tradeSize);
    if (quote.liquidityUSD < CONFIG.MIN_LIQUIDITY_USD) return null;

    const priceInUSD = TOKEN_PRICES_USD[pool.token0.name] || 1;
    const priceOutUSD = TOKEN_PRICES_USD[pool.token1.name] || 1;
    const impliedRate = priceInUSD / priceOutUSD;
    const actualRate = quote.amountOut / tradeSize;
    const spreadPct = ((actualRate - impliedRate) / impliedRate) * 100;

    return {
      pool,
      spreadPct,
      liquidityUSD: quote.liquidityUSD,
      amountOut: quote.amountOut
    };
  }

  async evaluateTriangularBest(route) {
    const tradeSize = parseFloat(CONFIG.TRADE_SIZE);
    const leg1 = await this.prices.getQuote({ token0: route.legs[0].tokenIn, token1: route.legs[0].tokenOut }, tradeSize);
    const leg2 = await this.prices.getQuote({ token0: route.legs[1].tokenIn, token1: route.legs[1].tokenOut }, leg1.amountOut);
    const direct = await this.prices.getQuote({ token0: route.direct.tokenIn, token1: route.direct.tokenOut }, tradeSize);

    const spreadPct = ((leg2.amountOut - direct.amountOut) / direct.amountOut) * 100;
    return { route, spreadPct, amountOut: leg2.amountOut, directOut: direct.amountOut };
  }

  async scan() {
    const executor = new ArbExecutor(provider);

    // Check explicit pools
    for (const pool of [...VIRTUAL_POOLS, ...AERO_POOLS, AERO_USDbC_POOL, ...WETH_DERIVATIVE_POOLS]) {
      const data = await this.getSpreadData(pool);
      if (data && data.spreadPct >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
        console.log(`VERIFIED ${pool.dex} ${pool.token0.name}/${pool.token1.name} spread=${data.spreadPct.toFixed(2)}%`);
        await executor.atomicTwoLegSwap({
          buyVenue: pool.dex,
          sellVenue: pool.dex,
          tokenIn: pool.token0,
          tokenOut: pool.token1,
          amountIn: CONFIG.TRADE_SIZE,
          minBuyOut: data.amountOut * 0.99,
          minSellOut: data.amountOut * 0.99,
          meta: pool.meta || {}
        });
      }
    }

    // Check triangular routes
    for (const route of TRIANGULAR_ROUTES) {
      const tri = await this.evaluateTriangularBest(route);
      if (tri.spreadPct >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
        console.log(`TRIANGULAR ${route.label} spread=${tri.spreadPct.toFixed(2)}%`);
        await executor.atomicTwoLegSwap({
          buyVenue: 'triangular',
          sellVenue: 'triangular',
          tokenIn: route.legs[0].tokenIn,
          tokenOut: route.legs[1].tokenOut,
          amountIn: CONFIG.TRADE_SIZE,
          minBuyOut: tri.amountOut * 0.99,
          minSellOut: tri.amountOut * 0.99,
          meta: {}
        });
      }
    }
  }
}

// ==================== EXECUTION ====================
async function main() {
  const detector = new ArbitrageDetector();
  await detector.scan();
  setInterval(() => detector.scan(), CONFIG.CHECK_INTERVAL_MS);

  const http = require('http');
  http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Arbitrage Bot running on Render with MEV-protected RPC.\n');
  }).listen(CONFIG.PORT, () => console.log(`Health check server on port ${CONFIG.PORT}`));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
