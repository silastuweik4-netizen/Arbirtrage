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
  PROFIT_RECIPIENT: process.env.PROFIT_RECIPIENT
};

// ==================== DEX ADDRESSES ====================
const DEX_ADDRESSES = {
  UNISWAP_V3_QUOTER:  "0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6",
  UNISWAP_V2_ROUTER:  "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
  AERODROME_ROUTER:   "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
  AERODROME_FACTORY:  "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
  PANCAKESWAP_V3_QUOTER: "0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2",
  UNISWAP_V3_FACTORY: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
  UNISWAP_V2_FACTORY: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6"
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

// ==================== POOLS ====================
const VIRTUAL_POOLS = [
  { dex: "aerodrome",  token0: TOKENS.VIRTUAL, token1: TOKENS.WETH,  meta: { stable: false } },
  { dex: "uniswap_v2", token0: TOKENS.VIRTUAL, token1: TOKENS.WETH },
  { dex: "uniswap_v3", token0: TOKENS.VIRTUAL, token1: TOKENS.WETH,  meta: { feeTiers: [100, 500, 3000, 10000] } },
  { dex: "uniswap_v3", token0: TOKENS.VIRTUAL, token1: TOKENS.USDC, meta: { feeTiers: [100, 500, 3000, 10000] } }
];

const AERO_POOLS = [
  { dex: "uniswap_v3", token0: TOKENS.AERO, token1: TOKENS.USDC, meta: { feeTiers: [100, 500, 3000, 10000] } },
  { dex: "aerodrome",  token0: TOKENS.AERO, token1: TOKENS.USDC, meta: { stable: false } }
];

const WETH_DERIVATIVE_POOLS = [
  { dex: "aerodrome", token0: TOKENS.msETH, token1: TOKENS.WETH, meta: { stable: false } },
  { dex: "aerodrome", token0: TOKENS.cbETH, token1: TOKENS.WETH, meta: { stable: false } }
];

// ==================== TRIANGULAR ROUTES ====================
const TRIANGULAR_ROUTES = [
  { label: "VIRTUAL-WETH-USDC", legs: [ { tokenIn: TOKENS.VIRTUAL, tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH,  tokenOut: TOKENS.USDC } ], direct: { tokenIn: TOKENS.VIRTUAL, tokenOut: TOKENS.USDC } },
  { label: "AERO-WETH-USDC",    legs: [ { tokenIn: TOKENS.AERO,    tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH,  tokenOut: TOKENS.USDC } ], direct: { tokenIn: TOKENS.AERO,    tokenOut: TOKENS.USDC } },
  { label: "AERO-USDbC-WETH",   legs: [ { tokenIn: TOKENS.AERO,    tokenOut: TOKENS.USDbC }, { tokenIn: TOKENS.USDbC, tokenOut: TOKENS.WETH } ], direct: { tokenIn: TOKENS.AERO,    tokenOut: TOKENS.WETH } },
  { label: "AERO-WETH-USDbC",   legs: [ { tokenIn: TOKENS.AERO,    tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH,  tokenOut: TOKENS.USDbC } ], direct: { tokenIn: TOKENS.AERO,    tokenOut: TOKENS.USDbC } },
  { label: "msETH-WETH-USDC",   legs: [ { tokenIn: TOKENS.msETH,   tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH,  tokenOut: TOKENS.USDC } ], direct: { tokenIn: TOKENS.msETH,   tokenOut: TOKENS.USDC } },
  { label: "cbETH-WETH-USDC",   legs: [ { tokenIn: TOKENS.cbETH,   tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH,  tokenOut: TOKENS.USDC } ], direct: { tokenIn: TOKENS.cbETH,   tokenOut: TOKENS.USDC } }
];

// ==================== ABIs ====================
const IQuoterABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];
const IRouterV2ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)"
];
const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];
const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB, bool stable) external view returns (address)"
];

// ==================== PRICE SOURCES (static placeholders) ====================
// If you have a live price feed, replace these with dynamic values.
const TOKEN_PRICES_USD = {
  WETH:  2500,
  USDC:  1,
  USDbC: 1,
  VIRTUAL: 1,   // placeholder
  AERO:  0.2,   // placeholder
  msETH: 2500,  // placeholder (derivative of ETH)
  cbETH: 2500   // placeholder (derivative of ETH)
};

// ==================== HELPERS ====================
async function quoteUniswapV3(tokenIn, tokenOut, fee, amountInWei) {
  const quoter = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_QUOTER, IQuoterABI, provider);
  return await quoter.callStatic.quoteExactInputSingle(tokenIn, tokenOut, fee, amountInWei, 0);
}

async function quoteRouterV2(routerAddress, path, amountInWei) {
  const router = new ethers.Contract(routerAddress, IRouterV2ABI, provider);
  const amounts = await router.getAmountsOut(amountInWei, path);
  return amounts[amounts.length - 1];
}

async function getAerodromeReserves(poolAddress, provider) {
  const pair = new ethers.Contract(poolAddress, PAIR_ABI, provider);
  const [reserve0, reserve1] = await pair.getReserves();
  const token0 = await pair.token0();
  const token1 = await pair.token1();
  return { reserve0, reserve1, token0, token1 };
}

async function getAerodromePair(tokenA, tokenB, stable) {
  const factory = new ethers.Contract(DEX_ADDRESSES.AERODROME_FACTORY, FACTORY_ABI, provider);
  return await factory.getPair(tokenA, tokenB, stable);
}

function reservesToUSD(reserve0, reserve1, token0, token1) {
  const tokenMeta0 = Object.values(TOKENS).find(t => t.address.toLowerCase() === token0.toLowerCase());
  const tokenMeta1 = Object.values(TOKENS).find(t => t.address.toLowerCase() === token1.toLowerCase());
  if (!tokenMeta0 || !tokenMeta1) return 0;

  const price0 = TOKEN_PRICES_USD[tokenMeta0.name] || 0;
  const price1 = TOKEN_PRICES_USD[tokenMeta1.name] || 0;

  const amount0 = parseFloat(ethers.utils.formatUnits(reserve0, tokenMeta0.decimals));
  const amount1 = parseFloat(ethers.utils.formatUnits(reserve1, tokenMeta1.decimals));

  return (amount0 * price0) + (amount1 * price1);
}

function logLiquidityCheck(poolLabel, liquidityUSD, threshold) {
  const status = liquidityUSD >= threshold ? "OK" : "LOW";
  console.log(`[LiquidityCheck] ${poolLabel} → $${liquidityUSD.toFixed(2)} USD (Threshold: $${threshold}) [${status}]`);
}

// ==================== PRICE FETCHER (refactored) ====================
class PriceFetcher {
  async getQuote(pool, amountIn) {
    const amountInWei = ethers.utils.parseUnits(String(amountIn), pool.token0.decimals);

    if (pool.dex === "uniswap_v3") {
      const tiers = (pool.meta && pool.meta.feeTiers) ? pool.meta.feeTiers : [3000];
      let bestOut = ethers.BigNumber.from(0);
      let bestFee = tiers[0];
      for (const fee of tiers) {
        try {
          const out = await quoteUniswapV3(pool.token0.address, pool.token1.address, fee, amountInWei);
          if (out.gt(bestOut)) { bestOut = out; bestFee = fee; }
        } catch (_) {}
      }
      return { amountOutWei: bestOut, venue: "uniswap_v3", meta: { fee: bestFee } };
    }

    if (pool.dex === "aerodrome") {
      // Confirm pool exists
      const pairAddress = await getAerodromePair(
        pool.token0.address,
        pool.token1.address,
        !!(pool.meta && pool.meta.stable)
      );
      if (pairAddress === ethers.constants.AddressZero) {
        console.log(`No Aerodrome pool found for ${pool.token0.name}/${pool.token1.name}`);
        return { amountOutWei: ethers.BigNumber.from(0), venue: "aerodrome", meta: {} };
      }

      // Check reserves and USD liquidity
      const { reserve0, reserve1, token0, token1 } = await getAerodromeReserves(pairAddress, provider);
      const liquidityUSD = reservesToUSD(reserve0, reserve1, token0, token1);
      logLiquidityCheck(`${pool.token0.name}/${pool.token1.name} Aerodrome`, liquidityUSD, CONFIG.MIN_LIQUIDITY_USD);

      if (liquidityUSD < CONFIG.MIN_LIQUIDITY_USD) {
        console.log(`Skipping ${pool.token0.name}/${pool.token1.name} — low USD liquidity`);
        return { amountOutWei: ethers.BigNumber.from(0), venue: "aerodrome", meta: {} };
      }

      // Safe to quote router
      try {
        const path = [pool.token0.address, pool.token1.address];
        const out = await quoteRouterV2(DEX_ADDRESSES.AERODROME_ROUTER, path, amountInWei);
        return { amountOutWei: out, venue: "aerodrome", meta: { stable: !!(pool.meta && pool.meta.stable) } };
      } catch (err) {
        console.error(`Aerodrome quote failed for ${pool.token0.name}/${pool.token1.name}:`, err.message);
        return { amountOutWei: ethers.BigNumber.from(0), venue: "aerodrome", meta: {} };
      }
    }

    if (pool.dex === "uniswap_v2") {
      try {
        const path = [pool.token0.address, pool.token1.address];
        const out = await quoteRouterV2(DEX_ADDRESSES.UNISWAP_V2_ROUTER, path, amountInWei);
        return { amountOutWei: out, venue: "uniswap_v2", meta: {} };
      } catch (err) {
        console.error(`Uniswap V2 quote failed for ${pool.token0.name}/${pool.token1.name}:`, err.message);
        return { amountOutWei: ethers.BigNumber.from(0), venue: "uniswap_v2", meta: {} };
      }
    }

    throw new Error(`Unsupported dex: ${pool.dex}`);
  }
}

// ==================== ARBITRAGE DETECTOR ====================
class ArbitrageDetector {
  constructor() {
    this.fetcher = new PriceFetcher();
  }

  async scan() {
    try {
      // Scan VIRTUAL pools
      for (const pool of VIRTUAL_POOLS) {
        await this._checkPool(pool);
      }

      // Scan AERO pools
      for (const pool of AERO_POOLS) {
        await this._checkPool(pool);
      }

      // Scan WETH derivative pools
      for (const pool of WETH_DERIVATIVE_POOLS) {
        await this._checkPool(pool);
      }

      // Scan triangular routes
      for (const route of TRIANGULAR_ROUTES) {
        await this._checkTriangular(route);
      }
    } catch (err) {
      console.error("Scan error:", err);
    }
  }

  async _checkPool(pool) {
    try {
      const quote = await this.fetcher.getQuote(pool, CONFIG.TRADE_SIZE);
      if (quote.amountOutWei.isZero()) return;

      const amountOut = parseFloat(ethers.utils.formatUnits(quote.amountOutWei, pool.token1.decimals));
      const spread = ((amountOut - CONFIG.TRADE_SIZE) / CONFIG.TRADE_SIZE) * 100;

      if (spread >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
        console.log(`VERIFIED ${quote.venue} ${pool.token0.name}/${pool.token1.name} spread=${spread.toFixed(2)}%`);
        await this._executeArb(pool, quote);
      }
    } catch (err) {
      console.error(`Pool scan error ${pool.token0.name}/${pool.token1.name}:`, err.message);
    }
  }

  async _checkTriangular(route) {
    try {
      let amountIn = ethers.utils.parseUnits(CONFIG.TRADE_SIZE, route.legs[0].tokenIn.decimals);
      let amountOut = amountIn;

      for (const leg of route.legs) {
        // Quote each leg via Uniswap V3 by default (as per original design)
        const pool = { dex: "uniswap_v3", token0: leg.tokenIn, token1: leg.tokenOut, meta: { feeTiers: [3000] } };
        const quote = await this.fetcher.getQuote(pool, ethers.utils.formatUnits(amountOut, leg.tokenIn.decimals));
        if (quote.amountOutWei.isZero()) return;
        amountOut = quote.amountOutWei;
      }

      const directPool = { dex: "uniswap_v3", token0: route.direct.tokenIn, token1: route.direct.tokenOut, meta: { feeTiers: [3000] } };
      const directQuote = await this.fetcher.getQuote(directPool, CONFIG.TRADE_SIZE);
      if (directQuote.amountOutWei.isZero()) return;

      const triOut = parseFloat(ethers.utils.formatUnits(amountOut, route.legs[route.legs.length - 1].tokenOut.decimals));
      const directOut = parseFloat(ethers.utils.formatUnits(directQuote.amountOutWei, route.direct.tokenOut.decimals));
      const spread = ((triOut - directOut) / directOut) * 100;

      if (spread >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
        console.log(`TRIANGULAR ${route.label} spread=${spread.toFixed(2)}%`);
        await this._executeArb(directPool, directQuote);
      }
    } catch (err) {
      console.error(`Triangular scan error ${route.label}:`, err.message);
    }
  }

  async _executeArb(pool, quote) {
    try {
      const router = this._routerForVenue(quote.venue);
      console.log(`Executing arb via router ${router} for ${pool.token0.name}/${pool.token1.name}`);
      await executeArb(pool, quote, router, CONFIG.PROFIT_RECIPIENT);
    } catch (err) {
      console.error("Execution error:", err.message);
    }
  }

  _routerForVenue(venue) {
    if (venue === "uniswap_v3") return DEX_ADDRESSES.UNISWAP_V2_ROUTER; // placeholder per original comment
    if (venue === "aerodrome")  return DEX_ADDRESSES.AERODROME_ROUTER;
    if (venue === "uniswap_v2") return DEX_ADDRESSES.UNISWAP_V2_ROUTER;
    return ethers.constants.AddressZero;
  }
}

// ==================== MAIN LOOP ====================
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
