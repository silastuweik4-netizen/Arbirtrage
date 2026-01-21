// detector.js
const { ethers } = require("ethers");
require("dotenv").config();
const { executeArb } = require("./arbexecutor");

// ==================== CONFIGURATION ====================
const CONFIG = {
  BASE_CHAIN_ID: 8453,
  RPC_URL: process.env.RPC_URL,
  PRICE_DIFFERENCE_THRESHOLD: parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD || "1.0"),
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS || "10000"),
  TRADE_SIZE: process.env.TRADE_SIZE || "1",
  MIN_LIQUIDITY_USD: parseFloat(process.env.MIN_LIQUIDITY_USD || "3000"),
  PORT: parseInt(process.env.PORT || "3000"),
  PROFIT_RECIPIENT: process.env.PROFIT_RECIPIENT,
  // Venues (set these in Render env)
  UNIV3_QUOTER: process.env.UNIV3_QUOTER,          // e.g., Base Uniswap v3 Quoter address
  AERODROME_ROUTER: process.env.AERODROME_ROUTER,  // e.g., Aerodrome router
  SUSHI_ROUTER: process.env.SUSHI_ROUTER           // optional, if you want v2-style quotes
};

const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== TOKENS ====================
const TOKENS = {
  WETH:   { address: "0x4200000000000000000000000000000000000006", name: "WETH",   decimals: 18 },
  USDC:   { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", name: "USDC",   decimals: 6 },
  USDbC:  { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", name: "USDbC",  decimals: 6 },
  VIRTUAL:{ address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", name: "VIRTUAL",decimals: 18 },
  AERO:   { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", name: "AERO",   decimals: 18 },
  msETH:  { address: "0x7Ba6F01772924a82D9626c126347A28299E98c98", name: "msETH",  decimals: 18 },
  cbETH:  { address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", name: "cbETH",  decimals: 18 }
};

// ==================== POOLS (as before) ====================
const VIRTUAL_POOLS = [
  { dex: "aerodrome",  pairAddress: "0x21594b992F68495dD28d605834b58889d0a727c7", token0: TOKENS.VIRTUAL, token1: TOKENS.WETH,  meta: { stable: false } },
  { dex: "uniswap_v2", pairAddress: "0xE31c372a7Af875b3B5E0F3713B17ef51556da667", token0: TOKENS.VIRTUAL, token1: TOKENS.WETH },
  { dex: "uniswap_v3", pairAddress: "0x1D4daB3f27C7F656b6323C1D6Ef713b48A8f72F1", token0: TOKENS.VIRTUAL, token1: TOKENS.WETH,  meta: { feeTiers: [100, 500, 3000, 10000] } },
  { dex: "uniswap_v3", pairAddress: "0x529d2863a1521d0b57db028168fdE2E97120017C", token0: TOKENS.VIRTUAL, token1: TOKENS.USDC, meta: { feeTiers: [100, 500, 3000, 10000] } }
];

const AERO_POOLS = [
  { dex: "uniswap_v3", pairAddress: "0xE5B5f522E98B5a2baAe212d4dA66b865B781DB97", token0: TOKENS.AERO, token1: TOKENS.USDC, meta: { feeTiers: [100, 500, 3000, 10000] } },
  { dex: "aerodrome", pairAddress: "0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d", token0: TOKENS.AERO, token1: TOKENS.USDC, meta: { stable: false } }
];

const AERO_USDbC_POOL = {
  dex: "aerodrome",
  pairAddress: "0x2223F9FE624F69Da4D8256A7bCc9104FBA7F8f75",
  token0: TOKENS.AERO,
  token1: TOKENS.USDbC,
  meta: { stable: false }
};

const msETH_WETH_AERODROME = {
  dex: "aerodrome",
  pairAddress: "0xDE4FB30cCC2f1210FcE2c8aD66410C586C8D1f9A",
  token0: TOKENS.msETH,
  token1: TOKENS.WETH,
  meta: { stable: false }
};

const msETH_WETH_SLIPSTREAM = {
  dex: "aerodrome",
  pairAddress: "0x74F72788F4814D7fF3C49B44684aa98Eee140C0E",
  token0: TOKENS.msETH,
  token1: TOKENS.WETH,
  meta: { stable: false }
};

const cbETH_WETH_SLIPSTREAM = {
  dex: "aerodrome",
  pairAddress: "0x47cA96Ea59C13F72745928887f84C9F52C3D7348",
  token0: TOKENS.cbETH,
  token1: TOKENS.WETH,
  meta: { stable: false }
};

const WETH_DERIVATIVE_POOLS = [
  msETH_WETH_AERODROME,
  msETH_WETH_SLIPSTREAM,
  cbETH_WETH_SLIPSTREAM
];

// ==================== TRIANGULAR ROUTES (as before) ====================
const TRIANGULAR_ROUTES = [
  { label: "VIRTUAL-WETH-USDC", legs: [ { tokenIn: TOKENS.VIRTUAL, tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH, tokenOut: TOKENS.USDC } ], direct: { tokenIn: TOKENS.VIRTUAL, tokenOut: TOKENS.USDC } },
  { label: "AERO-WETH-USDC",    legs: [ { tokenIn: TOKENS.AERO,    tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH,  tokenOut: TOKENS.USDC } ], direct: { tokenIn: TOKENS.AERO, tokenOut: TOKENS.USDC } },
  { label: "AERO-USDbC-WETH",   legs: [ { tokenIn: TOKENS.AERO,    tokenOut: TOKENS.USDbC }, { tokenIn: TOKENS.USDbC, tokenOut: TOKENS.WETH } ], direct: { tokenIn: TOKENS.AERO, tokenOut: TOKENS.WETH } },
  { label: "AERO-WETH-USDbC",   legs: [ { tokenIn: TOKENS.AERO,    tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH,  tokenOut: TOKENS.USDbC } ], direct: { tokenIn: TOKENS.AERO, tokenOut: TOKENS.USDbC } },
  { label: "msETH-WETH-USDC",   legs: [ { tokenIn: TOKENS.msETH,   tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH,  tokenOut: TOKENS.USDC } ], direct: { tokenIn: TOKENS.msETH, tokenOut: TOKENS.USDC } },
  { label: "cbETH-WETH-USDC",   legs: [ { tokenIn: TOKENS.cbETH,   tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH,  tokenOut: TOKENS.USDC } ], direct: { tokenIn: TOKENS.cbETH, tokenOut: TOKENS.USDC } }
];

// ==================== ABIs ====================
const IQuoterABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

const IRouterV2ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)"
];

// ==================== QUOTE HELPERS ====================
async function quoteUniswapV3(tokenIn, tokenOut, fee, amountInWei) {
  if (!CONFIG.UNIV3_QUOTER) throw new Error("UNIV3_QUOTER not set");
  const quoter = new ethers.Contract(CONFIG.UNIV3_QUOTER, IQuoterABI, provider);
  const out = await quoter.callStatic.quoteExactInputSingle(tokenIn, tokenOut, fee, amountInWei, 0);
  return out;
}

async function quoteRouterV2(routerAddress, path, amountInWei) {
  const router = new ethers.Contract(routerAddress, IRouterV2ABI, provider);
  const amounts = await router.getAmountsOut(amountInWei, path);
  return amounts[amounts.length - 1];
}

// ==================== PRICE FETCHER (real on-chain) ====================
class PriceFetcher {
  async getQuote(pool, amountIn) {
    const amountInWei = ethers.utils.parseUnits(String(amountIn), pool.token0.decimals);

    if (pool.dex === "uniswap_v3") {
      // Try best fee tier among provided; pick max output
      const tiers = (pool.meta && pool.meta.feeTiers) ? pool.meta.feeTiers : [3000];
      let bestOut = ethers.BigNumber.from(0);
      let bestFee = 3000;
      for (const fee of tiers) {
        try {
          const out = await quoteUniswapV3(pool.token0.address, pool.token1.address, fee, amountInWei);
          if (out.gt(bestOut)) { bestOut = out; bestFee = fee; }
        } catch (_) { /* ignore failing tiers */ }
      }
      return { amountOutWei: bestOut, venue: "uniswap_v3", meta: { fee: bestFee } };
    }

    if (pool.dex === "aerodrome") {
      if (!CONFIG.AERODROME_ROUTER) throw new Error("AERODROME_ROUTER not set");
      const path = [pool.token0.address, pool.token1.address];
      const out = await quoteRouterV2(CONFIG.AERODROME_ROUTER, path, amountInWei);
      return { amountOutWei: out, venue: "aerodrome", meta: { stable: !!(pool.meta && pool.meta.stable) } };
    }

    if (pool.dex === "uniswap_v2") {
      if (!CONFIG.SUSHI_ROUTER) throw new Error("SUSHI_ROUTER not set");
      const path = [pool.token0.address, pool.token1.address];
      const out = await quoteRouterV2(CONFIG.SUSHI_ROUTER, path, amountInWei);
      return { amountOutWei: out, venue: "uniswap_v2", meta: {} };
    }

    throw new Error(`Unsupported dex: ${pool.dex}`);
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

    // Convert output to float for comparison
    const amountOutFloat = parseFloat(ethers.utils.formatUnits(quote.amountOutWei, pool.token1.decimals));

    // Simple relative spread vs direct 1:1 expectation (replace with your baseline logic if needed)
    const spreadPct = ((amountOutFloat - tradeSize) / tradeSize) * 100;

    return {
      pool,
      spreadPct,
      amountOutFloat,
      quoteMeta: quote.meta,
      venue: quote.venue
    };
  }

  async evaluateTriangularBest(route) {
    const tradeSize = parseFloat(CONFIG.TRADE_SIZE);
    const amountInWei = ethers.utils.parseUnits(String(tradeSize), route.legs[0].tokenIn.decimals);

    // Leg 1: tokenIn -> mid
    const leg1Pool = this._inferPool(route.legs[0].tokenIn, route.legs[0].tokenOut);
    const leg1Quote = await this.prices.getQuote(leg1Pool, tradeSize);

    // Leg 2: mid -> tokenOut
    const leg1OutFloat = parseFloat(ethers.utils.formatUnits(leg1Quote.amountOutWei, route.legs[0].tokenOut.decimals));
    const leg2Pool = this._inferPool(route.legs[1].tokenIn, route.legs[1].tokenOut);
    const leg2Quote = await this.prices.getQuote(leg2Pool, leg1OutFloat);

    // Direct: tokenIn -> tokenOut
    const directPool = this._inferPool(route.direct.tokenIn, route.direct.tokenOut);
    const directQuote = await this.prices.getQuote(directPool, tradeSize);

    const leg2OutFloat = parseFloat(ethers.utils.formatUnits(leg2Quote.amountOutWei, route.legs[1].tokenOut.decimals));
    const directOutFloat = parseFloat(ethers.utils.formatUnits(directQuote.amountOutWei, route.direct.tokenOut.decimals));

    const spreadPct = ((leg2OutFloat - directOutFloat) / directOutFloat) * 100;

    return {
      route,
      spreadPct,
      amountOutFloat: leg2OutFloat,
      directOutFloat,
      meta: { leg1: leg1Quote.meta, leg2: leg2Quote.meta, direct: directQuote.meta }
    };
  }

  _inferPool(tokenIn, tokenOut) {
    // Prefer v3 where available; fallback to Aerodrome
    return {
      dex: "uniswap_v3",
      token0: tokenIn,
      token1: tokenOut,
      meta: { feeTiers: [500, 3000, 10000] }
    };
  }

  async scan() {
    // Explicit pools
    for (const pool of [...VIRTUAL_POOLS, ...AERO_POOLS, AERO_USDbC_POOL, ...WETH_DERIVATIVE_POOLS]) {
      try {
        const data = await this.getSpreadData(pool);
        if (data.spreadPct >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
          console.log(`VERIFIED ${data.venue} ${pool.token0.name}/${pool.token1.name} spread=${data.spreadPct.toFixed(2)}%`);

          const amountInWei = ethers.utils.parseUnits(String(CONFIG.TRADE_SIZE), pool.token0.decimals);
          const minBuyOutWei = ethers.utils.parseUnits(String(data.amountOutFloat * 0.99), pool.token1.decimals);
          const minSellOutWei = minBuyOutWei;

          const params = {
            dexBuy: this._dexCode(data.venue),
            dexSell: this._dexCode(data.venue),
            routerBuy: this._routerForVenue(data.venue),
            routerSell: this._routerForVenue(data.venue),
            tokenIn: pool.token0.address,
            tokenMid: pool.token1.address, // using two-leg simplification
            tokenOut: pool.token1.address,
            amountIn: amountInWei.toString(),
            minBuyOut: minBuyOutWei.toString(),
            minSellOut: minSellOutWei.toString(),
            feeBuy: (data.quoteMeta && data.quoteMeta.fee) ? data.quoteMeta.fee : 3000,
            feeSell: (data.quoteMeta && data.quoteMeta.fee) ? data.quoteMeta.fee : 3000,
            stableBuy: !!(data.quoteMeta && data.quoteMeta.stable),
            stableSell: !!(data.quoteMeta && data.quoteMeta.stable),
            factoryBuy: ethers.constants.AddressZero,
            factorySell: ethers.constants.AddressZero,
            recipient: CONFIG.PROFIT_RECIPIENT
          };

          await executeArb(params);
        }
      } catch (err) {
        console.error(`Pool scan error ${pool.token0.name}/${pool.token1.name}:`, err.message);
      }
    }

    // Triangular routes
    for (const route of TRIANGULAR_ROUTES) {
      try {
        const tri = await this.evaluateTriangularBest(route);
        if (tri.spreadPct >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
          console.log(`TRIANGULAR ${route.label} spread=${tri.spreadPct.toFixed(2)}%`);

          const amountInWei = ethers.utils.parseUnits(String(CONFIG.TRADE_SIZE), route.legs[0].tokenIn.decimals);
          const minOutWei = ethers.utils.parseUnits(String(tri.amountOutFloat * 0.99), route.legs[1].tokenOut.decimals);

          const params = {
            dexBuy: this._dexCode("uniswap_v3"),
            dexSell: this._dexCode("uniswap_v3"),
            routerBuy: this._routerForVenue("uniswap_v3"),
            routerSell: this._routerForVenue("uniswap_v3"),
            tokenIn: route.legs[0].tokenIn.address,
            tokenMid: route.legs[0].tokenOut.address,
            tokenOut: route.legs[1].tokenOut.address,
            amountIn: amountInWei.toString(),
            minBuyOut: minOutWei.toString(),
            minSellOut: minOutWei.toString(),
            feeBuy: 3000,
            feeSell: 3000,
            stableBuy: false,
            stableSell: false,
            factoryBuy: ethers.constants.AddressZero,
            factorySell: ethers.constants.AddressZero,
            recipient: CONFIG.PROFIT_RECIPIENT
          };

          await executeArb(params);
        }
      } catch (err) {
        console.error(`Triangular scan error ${route.label}:`, err.message);
      }
    }
  }

  _dexCode(venue) {
    switch (venue) {
      case "uniswap_v3": return 1;
      case "aerodrome":  return 2;
      case "uniswap_v2": return 3;
      default: return 0;
    }
  }

  _routerForVenue(venue) {
    if (venue === "uniswap_v3") return CONFIG.UNIV3_QUOTER;       // executor can map quoter→router internally if needed
    if (venue === "aerodrome")  return CONFIG.AERODROME_ROUTER;
    if (venue === "uniswap_v2") return CONFIG.SUSHI_ROUTER;
    return ethers.constants.AddressZero;
  }
}

// ==================== EXECUTION ====================
async function main() {
  const detector = new ArbitrageDetector();
  await detector.scan();
  setInterval(() => detector.scan(), CONFIG.CHECK_INTERVAL_MS);

  const http = require("http");
  http.createServer((_, res) => {
    res.writeHead(200);
    res.end("Arbitrage Bot running on Render.\n");
  }).listen(CONFIG.PORT, () => console.log(`Health check server on port ${CONFIG.PORT}`));
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
