// detector.js
require("dotenv").config();
const { ethers } = require("ethers");
const { executeArb } = require("./arbexecutor");

// ==================== CONFIG ====================
const CONFIG = {
  RPC_URL: process.env.RPC_URL || "https://base.llamarpc.com",
  PRICE_DIFFERENCE_THRESHOLD: parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD || "1.0"), // %
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS || "10000"),
  TRADE_SIZE: process.env.TRADE_SIZE || "1", // human units of token0
  MIN_LIQUIDITY_USD: parseFloat(process.env.MIN_LIQUIDITY_USD || "3000"),
  PORT: parseInt(process.env.PORT || "3000"),
  PROFIT_RECIPIENT: process.env.PROFIT_RECIPIENT
};

const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== DEX ADDRESSES ====================
const DEX_ADDRESSES = {
  UNISWAP_V3_QUOTER:  "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a".toLowerCase(),
  UNISWAP_V2_ROUTER:  "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24".toLowerCase(),
  AERODROME_ROUTER:   "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43".toLowerCase(),
  AERODROME_FACTORY:  "0x420DD381b31aEf6683db6B902084cB0FFECe40Da".toLowerCase()
};

// ==================== TOKENS ====================
const TOKENS = {
  WETH:   { address: "0x4200000000000000000000000000000000000006".toLowerCase(), name: "WETH",   decimals: 18 },
  USDC:   { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913".toLowerCase(), name: "USDC",   decimals: 6 },
  USDbC:  { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA".toLowerCase(), name: "USDbC",  decimals: 6 },
  VIRTUAL:{ address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b".toLowerCase(), name: "VIRTUAL",decimals: 18 },
  AERO:   { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631".toLowerCase(), name: "AERO",   decimals: 18 },
  msETH:  { address: "0x7Ba6F01772924a82D9626c126347A28299E98c98".toLowerCase(), name: "msETH",  decimals: 18 },
  cbETH:  { address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22".toLowerCase(), name: "cbETH",  decimals: 18 }
};

// ==================== STATIC PRICE PLACEHOLDERS ====================
const TOKEN_PRICES_USD = {
  WETH:  2500,
  USDC:  1,
  USDbC: 1,
  VIRTUAL: 1,
  AERO:  0.2,
  msETH: 2500,
  cbETH: 2500
};

// ==================== POOLS ====================
const VIRTUAL_POOLS = [
  { dex: "aerodrome",  token0: TOKENS.VIRTUAL, token1: TOKENS.WETH },
  { dex: "uniswap_v2", token0: TOKENS.VIRTUAL, token1: TOKENS.WETH },
  { dex: "uniswap_v3", token0: TOKENS.VIRTUAL, token1: TOKENS.WETH,  meta: { feeTiers: [3000] } },
  { dex: "uniswap_v3", token0: TOKENS.VIRTUAL, token1: TOKENS.USDC, meta: { feeTiers: [3000] } }
];

const AERO_POOLS = [
  { dex: "uniswap_v3", token0: TOKENS.AERO, token1: TOKENS.USDC, meta: { feeTiers: [3000] } },
  { dex: "aerodrome",  token0: TOKENS.AERO, token1: TOKENS.USDC }
];

const WETH_DERIVATIVE_POOLS = [
  { dex: "aerodrome", token0: TOKENS.msETH, token1: TOKENS.WETH },
  { dex: "aerodrome", token0: TOKENS.cbETH, token1: TOKENS.WETH }
];

// ==================== ABIs ====================
const IQuoterV2ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
];
const IRouterV2ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)"
];
const AERODROME_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, (address from,address to,bool stable,address factory)[] memory routes) external view returns (uint256[] memory amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] calldata routes, address to, uint256 deadline) external returns (uint256[] memory amounts)"
];
const UNISWAP_V2_ROUTER_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)"
];
const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];
const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, bool stable) external view returns (address)"
];

// ==================== HELPERS ====================
async function quoteUniswapV3(tokenIn, tokenOut, fee, amountInWei) {
  const quoter = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_QUOTER, IQuoterV2ABI, provider);
  const params = {
    tokenIn,
    tokenOut,
    amountIn: amountInWei,
    fee,
    sqrtPriceLimitX96: 0
  };
  const result = await quoter.callStatic.quoteExactInputSingle(params);
  return result.amountOut;
}
async function quoteRouterV2(routerAddress, path, amountInWei) {
  const router = new ethers.Contract(routerAddress, IRouterV2ABI, provider);
  const amounts = await router.getAmountsOut(amountInWei, path);
  return amounts[amounts.length - 1];
}
async function quoteAerodrome(routes, amountInWei) {
  const router = new ethers.Contract(DEX_ADDRESSES.AERODROME_ROUTER, AERODROME_ROUTER_ABI, provider);
  const amounts = await router.getAmountsOut(amountInWei, routes);
  return amounts[amounts.length - 1];
}
async function getAerodromeReserves(pairAddress) {
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
  const [reserve0, reserve1] = await pair.getReserves();
  const token0 = await pair.token0();
  const token1 = await pair.token1();
  return { reserve0, reserve1, token0, token1 };
}
async function getAerodromePool(tokenA, tokenB, stable) {
  const factory = new ethers.Contract(DEX_ADDRESSES.AERODROME_FACTORY, FACTORY_ABI, provider);
  return factory.getPool(tokenA, tokenB, stable);
}
function reservesToUSD(reserve0, reserve1, token0, token1) {
  const meta0 = Object.values(TOKENS).find(t => t.address.toLowerCase() === token0.toLowerCase());
  const meta1 = Object.values(TOKENS).find(t => t.address.toLowerCase() === token1.toLowerCase());
  if (!meta0 || !meta1) return 0;
  const price0 = TOKEN_PRICES_USD[meta0.name] || 0;
  const price1 = TOKEN_PRICES_USD[meta1.name] || 0;
  const amt0 = parseFloat(ethers.utils.formatUnits(reserve0, meta0.decimals));
  const amt1 = parseFloat(ethers.utils.formatUnits(reserve1, meta1.decimals));
  return (amt0 * price0) + (amt1 * price1);
}

// ==================== PRICE FETCHER (durable) ====================
class PriceFetcher {
  async getQuote(pool, amountInHuman) {
    const amountInWei = ethers.utils.parseUnits(String(amountInHuman), pool.token0.decimals);

    // Uniswap V3
    if (pool.dex === "uniswap_v3") {
      const tiers = (pool.meta && pool.meta.feeTiers) ? pool.meta.feeTiers : [3000];
      let bestOut = ethers.BigNumber.from(0);
      let bestFee = tiers[0];
      for (const fee of tiers) {
        try {
          const out = await quoteUniswapV3(pool.token0.address, pool.token1.address, fee, amountInWei);
          if (out.gt(bestOut)) { bestOut = out; bestFee = fee; }
        } catch (_) { /* ignore tier errors */ }
      }
      return { amountOutWei: bestOut, venue: "uniswap_v3", meta: { fee: bestFee } };
    }

    // Uniswap V2
    if (pool.dex === "uniswap_v2") {
      try {
        const path = [pool.token0.address, pool.token1.address];
        const out = await quoteRouterV2(DEX_ADDRESSES.UNISWAP_V2_ROUTER, path, amountInWei);
        return { amountOutWei: out, venue: "uniswap_v2", meta: {} };
      } catch (err) {
        return { amountOutWei: ethers.BigNumber.from(0), venue: "uniswap_v2", meta: {} };
      }
    }

    // Aerodrome
    if (pool.dex === "aerodrome") {
      try {
        const poolVol = await getAerodromePool(pool.token0.address, pool.token1.address, false);
        const poolStb = await getAerodromePool(pool.token0.address, pool.token1.address, true);

        const chosen = poolVol !== ethers.constants.AddressZero
          ? { addr: poolVol, stable: false }
          : poolStb !== ethers.constants.AddressZero
            ? { addr: poolStb, stable: true }
            : null;

        if (!chosen) {
          return { amountOutWei: ethers.BigNumber.from(0), venue: "aerodrome", meta: {} };
        }

        const { reserve0, reserve1, token0, token1 } = await getAerodromeReserves(chosen.addr);
        const liquidityUSD = reservesToUSD(reserve0, reserve1, token0, token1);
        
        if (liquidityUSD < CONFIG.MIN_LIQUIDITY_USD) {
          return { amountOutWei: ethers.BigNumber.from(0), venue: "aerodrome", meta: {} };
        }

        const routes = [{
          from:    pool.token0.address,
          to:      pool.token1.address,
          stable:  chosen.stable,
          factory: DEX_ADDRESSES.AERODROME_FACTORY
        }];

        const out = await quoteAerodrome(routes, amountInWei);
        return { amountOutWei: out, venue: "aerodrome", meta: { stable: chosen.stable } };
      } catch (err) {
        return { amountOutWei: ethers.BigNumber.from(0), venue: "aerodrome", meta: {} };
      }
    }

    throw new Error(`Unsupported dex: ${pool.dex}`);
  }
}

// ==================== DETECTOR ====================
class ArbitrageDetector {
  constructor() {
    this.fetcher = new PriceFetcher();
  }

  async scan() {
    console.log(`\n🚀 Starting scan at ${new Date().toISOString()}`);
    try {
      for (const pool of VIRTUAL_POOLS)            await this._checkPool(pool);
      for (const pool of AERO_POOLS)               await this._checkPool(pool);
      for (const pool of WETH_DERIVATIVE_POOLS)    await this._checkPool(pool);
      for (const route of TRIANGULAR_ROUTES)       await this._checkTriangular(route);
    } catch (err) {
      console.error("Scan error:", err);
    }
  }

  async _checkPool(pool) {
    try {
      const quote = await this.fetcher.getQuote(pool, CONFIG.TRADE_SIZE);
      if (quote.amountOutWei.isZero()) return;

      const amountOut = parseFloat(ethers.utils.formatUnits(quote.amountOutWei, pool.token1.decimals));
      const spread = ((amountOut - Number(CONFIG.TRADE_SIZE)) / Number(CONFIG.TRADE_SIZE)) * 100;

      console.log(`📊 ${quote.venue} ${pool.token0.name}/${pool.token1.name} spread=${spread.toFixed(2)}%`);
      if (spread >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
        console.log(`✅ [OPPORTUNITY] FOUND!`);
        await this._executeArb(pool, quote);
      }
    } catch (err) {
      console.error(`Pool scan error ${pool.token0.name}/${pool.token1.name}: ${err.message}`);
    }
  }

  async _checkTriangular(route) {
    try {
      let amountIn = ethers.utils.parseUnits(CONFIG.TRADE_SIZE, route.legs[0].tokenIn.decimals);
      let amountOut = amountIn;

      for (const leg of route.legs) {
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

      console.log(`📊 [TRIANGULAR] ${route.label} spread=${spread.toFixed(2)}%`);
      if (spread >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
        console.log(`✅ [TRIANGULAR] OPPORTUNITY FOUND!`);
        // For triangular, we'd need a more complex executor, but for now we'll use the simple one
        await this._executeArb(directPool, directQuote);
      }
    } catch (err) {
      console.error(`Triangular scan error ${route.label}: ${err.message}`);
    }
  }

  async _executeArb(pool, quote) {
    try {
      // Prepare swap data for the contract
      // This is a simplified version - in production you'd need to encode the exact swap calls
      const deadline = Math.floor(Date.now() / 1000) + 600;
      
      // Example encoding for Uniswap V2
      const uniInterface = new ethers.utils.Interface(UNISWAP_V2_ROUTER_ABI);
      const swapDataUni = uniInterface.encodeFunctionData("swapExactTokensForTokens", [
        ethers.utils.parseUnits(String(CONFIG.TRADE_SIZE), pool.token0.decimals),
        0, // minAmountOut
        [pool.token0.address, pool.token1.address],
        process.env.ARB_CONTRACT_ADDRESS || "0x68168c8A65DA9Ed1cb2B674E2039C31a40BFC336",
        deadline
      ]);

      // Example encoding for Aerodrome
      const aeroInterface = new ethers.utils.Interface(AERODROME_ROUTER_ABI);
      const routes = [{
        from: pool.token1.address,
        to: pool.token0.address,
        stable: !!quote.meta?.stable,
        factory: DEX_ADDRESSES.AERODROME_FACTORY
      }];
      const swapDataAero = aeroInterface.encodeFunctionData("swapExactTokensForTokens", [
        quote.amountOutWei,
        0, // minAmountOut
        routes,
        process.env.ARB_CONTRACT_ADDRESS || "0x68168c8A65DA9Ed1cb2B674E2039C31a40BFC336",
        deadline
      ]);

      await executeArb({
        tokenBorrow: pool.token0.address,
        amountBorrow: ethers.utils.parseUnits(String(CONFIG.TRADE_SIZE), pool.token0.decimals),
        tokenIn: pool.token0.address,
        tokenOut: pool.token1.address,
        minAmountOut: ethers.utils.parseUnits(String(CONFIG.TRADE_SIZE), pool.token0.decimals), // Must at least return what we borrowed
        swapDataA_Uni: swapDataUni,
        swapDataA_Aero: "0x", // Placeholder
        swapDataB_Uni: "0x", // Placeholder
        swapDataB_Aero: swapDataAero
      });
    } catch (err) {
      console.error(`Execution error: ${err.message}`);
    }
  }
}

// ==================== TRIANGULAR ROUTES ====================
const TRIANGULAR_ROUTES = [
  { label: "VIRTUAL-WETH-USDC", legs: [ { tokenIn: TOKENS.VIRTUAL, tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH,  tokenOut: TOKENS.USDC } ], direct: { tokenIn: TOKENS.VIRTUAL, tokenOut: TOKENS.USDC } },
  { label: "AERO-WETH-USDC",    legs: [ { tokenIn: TOKENS.AERO,    tokenOut: TOKENS.WETH }, { tokenIn: TOKENS.WETH,  tokenOut: TOKENS.USDC } ], direct: { tokenIn: TOKENS.AERO,    tokenOut: TOKENS.USDC } }
];

// ==================== MAIN ====================
async function main() {
  const detector = new ArbitrageDetector();
  await detector.scan();
  setInterval(() => detector.scan(), CONFIG.CHECK_INTERVAL_MS);

  const http = require("http");
  http.createServer((_, res) => {
    res.writeHead(200);
    res.end("Arbitrage Bot running.\n");
  }).listen(CONFIG.PORT, () => console.log(`Health server on port ${CONFIG.PORT}`));
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
