// threeWayScanner.js
// Updated: safer provider, callStatic usage, verbose errors, concurrency limiter, simple caching.
// Note: adjust RPC_URL, QUOTERS, and PAIR_DATA source as needed for your environment.

const { ethers } = require('ethers');
const ThreeWayArbitrageCalculator = require('./threeWayArbitrageCalculator');

const RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com';
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 8453, name: 'base' });

const QUOTERS = {
  AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
  UNISWAP: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0", // verify this is intentional
  PANCAKESWAP: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997"
};

const FEE_TIERS = [100, 500, 2500, 3000, 10000];
const QUOTER_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
];

/**
 * Simple concurrency limiter factory.
 * Returns a wrapper that schedules async tasks with a concurrency limit.
 */
function createLimiter(concurrency = 6) {
  let active = 0;
  const queue = [];

  const runNext = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn()
      .then((res) => {
        resolve(res);
      })
      .catch((err) => {
        reject(err);
      })
      .finally(() => {
        active--;
        runNext();
      });
  };

  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      // try to run immediately
      setImmediate(runNext);
    });
  };
}

class ThreeWayScanner {
  constructor() {
    this.aero = new ethers.Contract(QUOTERS.AERODROME, QUOTER_ABI, provider);
    this.uniswap = new ethers.Contract(QUOTERS.UNISWAP, QUOTER_ABI, provider);
    this.pancake = new ethers.Contract(QUOTERS.PANCAKESWAP, QUOTER_ABI, provider);
    this.profitCalc = new ThreeWayArbitrageCalculator();
    this.requestCount = 0;
    this.opportunities = [];
    this.quoteCache = new Map(); // simple in-memory cache for identical quote requests
    this.limit = createLimiter(6); // tune concurrency to your RPC limits

    // Optional pairConfig (kept for reference). The scanner uses profitCalc.PAIR_DATA by default.
    this.pairConfig = new Map([
      ['WETH/USDC', { token0: '0x4200000000000000000000000000000000000006', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', inDec: 18, outDec: 6 }],
      ['WETH/USDbC', { token0: '0x4200000000000000000000000000000000000006', token1: '0xd9aAEc86B65D86f6A7B630E2C953757eFB0d5E88', inDec: 18, outDec: 6 }],
      // ... keep other entries as needed
    ]);
  }

  async initialize() {
    try {
      const block = await provider.getBlockNumber();
      console.log(`\n✅ 3-Way Arbitrage Scanner Initialized`);
      console.log(`📍 Block: ${block}`);
      console.log(`🏢 DEXes: Aerodrome, Uniswap V3, PancakeSwap`);
      console.log(`📊 Pairs to scan: ${this.profitCalc.PAIR_DATA.length}\n`);
    } catch (e) {
      console.error("❌ Connection failed", e && (e.message || e));
    }
  }

  /**
   * Build a cache key for quote requests.
   */
  _cacheKey(dex, tokenIn, tokenOut, fee, amountInScaled) {
    return `${dex}|${tokenIn}|${tokenOut}|${fee}|${amountInScaled.toString()}`;
  }

  /**
   * Get a quote from a DEX quoter contract.
   * Uses callStatic and robust parsing of return shapes.
   * Returns a BigInt amountOut or 0n on failure.
   */
  async getQuote(dex, tokenIn, tokenOut, fee, amountInScaled) {
    // Basic validation
    if (!tokenIn || !tokenOut || amountInScaled === undefined || amountInScaled === null) {
      console.warn('getQuote: missing args', { dex, tokenIn, tokenOut, fee, amountInScaled });
      return 0n;
    }

    // Normalize amountInScaled to BigInt
    let amountArg;
    try {
      amountArg = typeof amountInScaled === 'bigint' ? amountInScaled : BigInt(amountInScaled.toString());
    } catch (err) {
      console.warn('getQuote: invalid amountInScaled', amountInScaled, err && (err.message || err));
      return 0n;
    }

    const cacheKey = this._cacheKey(dex, tokenIn, tokenOut, fee, amountArg);
    if (this.quoteCache.has(cacheKey)) {
      return this.quoteCache.get(cacheKey);
    }

    // Wrap the actual RPC call with concurrency limiter
    const callFn = async () => {
      try {
        this.requestCount++;
        const contract = dex === 'PANCAKE' ? this.pancake : (dex === 'UNI' ? this.uniswap : this.aero);

        // For Uniswap/Pancake (single hop)
        if (dex === 'PANCAKE' || dex === 'UNI') {
          const params = { tokenIn, tokenOut, amountIn: amountArg, fee, sqrtPriceLimitX96: 0 };
          const res = await contract.callStatic.quoteExactInputSingle(params);
          // res may be an object with named fields or an array/BigInt
          let amountOut = 0n;
          if (res === undefined || res === null) {
            amountOut = 0n;
          } else if (typeof res === 'bigint') {
            amountOut = res;
          } else if (res.amountOut !== undefined) {
            amountOut = BigInt(res.amountOut);
          } else if (Array.isArray(res) && res.length > 0) {
            try { amountOut = BigInt(res[0]); } catch (e) { amountOut = 0n; }
          } else {
            // fallback: try to coerce
            try { amountOut = BigInt(res.toString()); } catch (e) { amountOut = 0n; }
          }

          this.quoteCache.set(cacheKey, amountOut);
          return amountOut;
        } else {
          // Aerodrome: pack path as bytes (tokenIn + fee(uint24) + tokenOut)
          const path = ethers.utils.solidityPack(['address', 'uint24', 'address'], [tokenIn, fee, tokenOut]);
          const res = await contract.callStatic.quoteExactInput(path, amountArg);
          let amountOut = 0n;
          if (res === undefined || res === null) {
            amountOut = 0n;
          } else if (typeof res === 'bigint') {
            amountOut = res;
          } else if (res.amountOut !== undefined) {
            amountOut = BigInt(res.amountOut);
          } else if (Array.isArray(res) && res.length > 0) {
            try { amountOut = BigInt(res[0]); } catch (e) { amountOut = 0n; }
          } else {
            try { amountOut = BigInt(res.toString()); } catch (e) { amountOut = 0n; }
          }

          this.quoteCache.set(cacheKey, amountOut);
          return amountOut;
        }
      } catch (err) {
        // Log full error for debugging (revert reason, ABI mismatch, rate limit, etc.)
        console.warn(`getQuote error dex=${dex} tokenIn=${tokenIn} tokenOut=${tokenOut} fee=${fee}`, err && (err.message || err));
        // Cache a short-lived zero to avoid immediate repeated failing calls; you may choose to not cache failures.
        this.quoteCache.set(cacheKey, 0n);
        return 0n;
      }
    };

    // Schedule via limiter
    try {
      const amountOut = await this.limit(callFn);
      return amountOut;
    } catch (err) {
      console.warn('getQuote limiter error', err && (err.message || err));
      return 0n;
    }
  }

  /**
   * Format BigInt amount to a JS number using decimals.
   * Returns 0 for zero amounts.
   */
  formatPrice(amount, decimals) {
    try {
      if (!amount || amount === 0n) return 0;
      return parseFloat(ethers.formatUnits(amount, decimals));
    } catch (err) {
      console.warn('formatPrice error', err && (err.message || err));
      return 0;
    }
  }

  /**
   * Main scanning loop.
   * Iterates over this.profitCalc.PAIR_DATA (expected to be an array of pair objects).
   */
  async scanForArbitrageOpportunities() {
    this.requestCount = 0;
    this.opportunities = [];
    this.quoteCache.clear();

    const pairDataList = Array.isArray(this.profitCalc.PAIR_DATA) ? this.profitCalc.PAIR_DATA : [];
    console.log(`🔍 Scanning ${pairDataList.length} pairs across 3 DEXes...\n`);

    for (const pairData of pairDataList) {
      // Validate pairData shape
      if (!pairData || !pairData.token0 || !pairData.token1 || !pairData.amountInScaled) {
        console.warn('Skipping invalid pairData', pairData);
        continue;
      }

      const token0 = pairData.token0;
      const token1 = pairData.token1;
      const amountInScaled = pairData.amountInScaled;
      const outDec = pairData.outDec ?? 18;
      const pairName = pairData.pair ?? `${token0}/${token1}`;

      let bestAero = 0n, bestUni = 0n, bestPancake = 0n;

      // For each fee tier, query all three DEXes (scheduled through limiter)
      // We'll collect promises per fee and await them in parallel (subject to limiter)
      const feePromises = FEE_TIERS.map(async (fee) => {
        // Each getQuote call is itself scheduled by limiter; here we just call them concurrently
        const [aQ, uQ, pQ] = await Promise.all([
          this.getQuote('AERO', token0, token1, fee, amountInScaled),
          this.getQuote('UNI', token0, token1, fee, amountInScaled),
          this.getQuote('PANCAKE', token0, token1, fee, amountInScaled)
        ]);
        return { fee, aQ, uQ, pQ };
      });

      // Use Promise.allSettled to avoid a single failure rejecting everything
      const feeResults = await Promise.allSettled(feePromises);

      for (const settled of feeResults) {
        if (settled.status === 'fulfilled') {
          const { aQ, uQ, pQ } = settled.value;
          if (aQ > bestAero) bestAero = aQ;
          if (uQ > bestUni) bestUni = uQ;
          if (pQ > bestPancake) bestPancake = pQ;
        } else {
          // Log the error for this fee batch
          console.warn('Fee batch failed', settled.reason && (settled.reason.message || settled.reason));
        }
      }

      // Format prices
      const aeroPrice = this.formatPrice(bestAero, outDec);
      const uniPrice = this.formatPrice(bestUni, outDec);
      const pancakePrice = this.formatPrice(bestPancake, outDec);

      console.log(`📊 ${pairName.padEnd(20)} | Aero: ${aeroPrice.toFixed(6).padEnd(12)} | Uni: ${uniPrice.toFixed(6).padEnd(12)} | PanCake: ${pancakePrice.toFixed(6).padEnd(12)}`);

      // Calculate profitability if all quotes are present
      if (aeroPrice > 0 && uniPrice > 0 && pancakePrice > 0) {
        try {
          const profitAnalysis = this.profitCalc.findBestRoute({
            pair: pairName,
            fee: pairData.fee,
            aero: aeroPrice,
            uni: uniPrice,
            pancake: pancakePrice
          });

          if (profitAnalysis && profitAnalysis.isProfitable) {
            const recommendation = this.profitCalc.getRecommendation(profitAnalysis.netBp);
            console.log(`   ${recommendation}`);
            console.log(`   Buy: ${profitAnalysis.buyDex} @ ${profitAnalysis.buyPrice.toFixed(6)} → Sell: ${profitAnalysis.sellDex} @ ${profitAnalysis.sellPrice.toFixed(6)}`);
            console.log(`   Profit: ${profitAnalysis.netBp} bp = $${profitAnalysis.profitPer100k}/100k = $${profitAnalysis.profitPer1M}/1M\n`);

            this.opportunities.push(profitAnalysis);
          } else {
            console.log(`   ❌ Not profitable: ${profitAnalysis ? profitAnalysis.netBp : 'N/A'} bp\n`);
          }
        } catch (err) {
          console.warn('Profit calc error', err && (err.message || err));
        }
      } else {
        console.log(`   ❌ Missing quotes (one or more DEXes returned zero)\n`);
      }
    }

    // Summary
    console.log(`${'='.repeat(80)}`);
    console.log(`📊 SCAN SUMMARY`);
    console.log(`Profitable Opportunities: ${this.opportunities.length}`);
    console.log(`RPC Requests: ${this.requestCount}`);
    console.log(`${'='.repeat(80)}\n`);

    if (this.opportunities.length > 0) {
      console.log(`🏆 OPPORTUNITIES (sorted by profit):\n`);
      this.opportunities
        .sort((a, b) => parseFloat(b.netBp) - parseFloat(a.netBp))
        .forEach((opp, i) => {
          console.log(`${i + 1}. ${opp.pair.padEnd(20)} | ${opp.netBp} bp | $${opp.profitPer100k}/100k | BUY: ${opp.buyDex} → SELL: ${opp.sellDex}`);
        });
      console.log();
    }

    return this.opportunities;
  }
}

module.exports = ThreeWayScanner;
