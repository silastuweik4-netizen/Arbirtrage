// threeWayScanner.js
// Patched: correct ABIs for Uniswap/Pancake (v3) and Aerodrome, address normalization,
// buildPairDataFromConfig integrated, callStatic usage, robust error logging.

const { ethers } = require('ethers');
const ThreeWayArbitrageCalculator = require('./threeWayArbitrageCalculator');

const RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/YOUR_KEY_HERE';
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 8453, name: 'base' });

// Replace these with the actual deployed quoter contract addresses for Base
const QUOTER_ADDRESSES = {
  AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0", // verify
  UNISWAP:  "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0", // verify
  PANCAKESWAP: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" // verify
};

// Uniswap v3 / Pancake v3 Quoter ABI (canonical)
const V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut)",
  "function quoteExactOutputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountOut, uint160 sqrtPriceLimitX96) external returns (uint256 amountIn)",
  "function quoteExactOutput(bytes path, uint256 amountOut) external returns (uint256 amountIn)"
];

// Aerodrome Quoter ABI (path-based)
const AERODROME_QUOTER_ABI = [
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut)",
  "function quoteExactOutput(bytes path, uint256 amountOut) external returns (uint256 amountIn)"
];

const FEE_TIERS = [100, 500, 2500, 3000, 10000];

class ThreeWayScanner {
  constructor() {
    // We'll create contract instances after normalizing addresses in initialize()
    this.aero = null;
    this.uniswap = null;
    this.pancake = null;

    this.profitCalc = new ThreeWayArbitrageCalculator();
    this.requestCount = 0;
    this.opportunities = [];

    // Raw token config (may contain mixed-case or non-checksummed addresses)
    // Keep this list complete as you had it; shortened here for brevity — include all your pairs.
    this.pairConfigRaw = new Map([
      ['WETH/USDC', { token0: '0x4200000000000000000000000000000000000006', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', inDec: 18, outDec: 6 }],
      ['WETH/USDbC', { token0: '0x4200000000000000000000000000000000000006', token1: '0xd9aAEc86B65D86f6A7B630E2C953757eFB0d5E88', inDec: 18, outDec: 6 }],
      ['cbETH/WETH', { token0: '0x2Ae3F1eB1fC2e6d6d8D042C9D066bC06D9455358', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
      ['wstETH/WETH', { token0: '0xc1CBa3fCea344f92D75dB2fe0b2564dBAccF2fbe', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
      ['WETH/DAI', { token0: '0x4200000000000000000000000000000000000006', token1: '0x50c5725949A6F0c72E6C4a641F14122319976f97', inDec: 18, outDec: 18 }],
      // ... add the rest of your pairs here exactly as in your original config
    ]);

    // Simple in-memory cache for identical quote requests (optional)
    this.quoteCache = new Map();
  }

  /**
   * Normalize addresses in pairConfigRaw and quoter addresses.
   * Create contract instances with the correct ABIs.
   */
  _normalizeAddress(addr) {
    try {
      return ethers.getAddress(addr);
    } catch (err) {
      // If getAddress fails, try lowercasing (some addresses in logs were mixed-case)
      try {
        return ethers.getAddress(addr.toLowerCase());
      } catch (e) {
        console.warn('Invalid address provided, cannot normalize:', addr, e && (e.message || e));
        throw e;
      }
    }
  }

  buildPairDataFromConfig(defaultAmount = '1') {
    const list = [];
    for (const [pair, cfg] of this.pairConfigRaw.entries()) {
      try {
        const token0 = this._normalizeAddress(cfg.token0);
        const token1 = this._normalizeAddress(cfg.token1);
        const amountInScaled = ethers.parseUnits(defaultAmount, cfg.inDec);
        list.push({
          pair,
          token0,
          token1,
          amountInScaled,
          outDec: cfg.outDec ?? cfg.inDec
        });
      } catch (err) {
        console.warn('Skipping pair due to invalid address in config:', pair, err && (err.message || err));
      }
    }
    return list;
  }

  async initialize(defaultAmount = '1') {
    try {
      // Normalize quoter addresses and create contract instances with correct ABIs
      const aeroAddr = this._normalizeAddress(QUOTER_ADDRESSES.AERODROME);
      const uniAddr = this._normalizeAddress(QUOTER_ADDRESSES.UNISWAP);
      const pancakeAddr = this._normalizeAddress(QUOTER_ADDRESSES.PANCAKESWAP);

      this.aero = new ethers.Contract(aeroAddr, AERODROME_QUOTER_ABI, provider);
      this.uniswap = new ethers.Contract(uniAddr, V3_QUOTER_ABI, provider);
      this.pancake = new ethers.Contract(pancakeAddr, V3_QUOTER_ABI, provider);

      // Build PAIR_DATA for live on-chain quoting
      this.profitCalc.PAIR_DATA = this.buildPairDataFromConfig(defaultAmount);

      const block = await provider.getBlockNumber();
      console.log(`\n✅ 3-Way Arbitrage Scanner Initialized`);
      console.log(`📍 Block: ${block}`);
      console.log(`🏢 DEXes: Aerodrome, Uniswap V3, PancakeSwap`);
      console.log(`📊 Pairs to scan: ${this.profitCalc.PAIR_DATA.length}\n`);
      console.log('PAIR_DATA sample:', this.profitCalc.PAIR_DATA.slice(0,5));
    } catch (e) {
      console.error('Initialization failed', e && (e.message || e));
      throw e;
    }
  }

  _cacheKey(dex, tokenIn, tokenOut, fee, amountInScaled) {
    return `${dex}|${tokenIn}|${tokenOut}|${fee}|${amountInScaled.toString()}`;
  }

  /**
   * Get a quote from the appropriate quoter contract.
   * - For Uniswap/Pancake (v3): use quoteExactInputSingle
   * - For Aerodrome: use quoteExactInput with packed path
   *
   * Returns BigInt amountOut or 0n on failure.
   */
  async getQuote(dex, tokenIn, tokenOut, fee, amountInScaled) {
    if (!tokenIn || !tokenOut || amountInScaled === undefined || amountInScaled === null) {
      console.warn('getQuote: missing args', { dex, tokenIn, tokenOut, fee, amountInScaled });
      return 0n;
    }

    // Normalize amount to BigInt
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

    try {
      this.requestCount++;
      if (dex === 'UNI') {
        if (!this.uniswap || !this.uniswap.callStatic || !this.uniswap.callStatic.quoteExactInputSingle) {
          throw new Error('Uniswap quoter contract missing quoteExactInputSingle');
        }
        // Uniswap v3 expects (tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96)
        const res = await this.uniswap.callStatic.quoteExactInputSingle(
          tokenIn,
          tokenOut,
          fee,
          amountArg,
          0
        );
        const amountOut = BigInt(res ?? 0);
        this.quoteCache.set(cacheKey, amountOut);
        return amountOut;
      } else if (dex === 'PANCAKE') {
        if (!this.pancake || !this.pancake.callStatic || !this.pancake.callStatic.quoteExactInputSingle) {
          throw new Error('Pancake quoter contract missing quoteExactInputSingle');
        }
        const res = await this.pancake.callStatic.quoteExactInputSingle(
          tokenIn,
          tokenOut,
          fee,
          amountArg,
          0
        );
        const amountOut = BigInt(res ?? 0);
        this.quoteCache.set(cacheKey, amountOut);
        return amountOut;
      } else {
        // Aerodrome path-based: pack tokenIn + fee(uint24) + tokenOut
        if (!this.aero || !this.aero.callStatic || !this.aero.callStatic.quoteExactInput) {
          throw new Error('Aerodrome quoter contract missing quoteExactInput');
        }
        // solidityPack helper: use utils.solidityPack
        const path = ethers.utils.solidityPack(['address', 'uint24', 'address'], [tokenIn, fee, tokenOut]);
        const res = await this.aero.callStatic.quoteExactInput(path, amountArg);
        const amountOut = BigInt(res ?? 0);
        this.quoteCache.set(cacheKey, amountOut);
        return amountOut;
      }
    } catch (err) {
      // Log detailed error for debugging (ABI mismatch, revert reason, checksum issues)
      console.warn(`getQuote error dex=${dex} tokenIn=${tokenIn} tokenOut=${tokenOut} fee=${fee}`, err && (err.message || err));
      // Cache a short-lived zero to avoid repeated failing calls; remove caching if you prefer fresh retries
      this.quoteCache.set(cacheKey, 0n);
      return 0n;
    }
  }

  formatPrice(amount, decimals) {
    try {
      if (!amount || amount === 0n) return 0;
      return parseFloat(ethers.formatUnits(amount, decimals));
    } catch (err) {
      console.warn('formatPrice error', err && (err.message || err));
      return 0;
    }
  }

  async scanForArbitrageOpportunities() {
    this.requestCount = 0;
    this.opportunities = [];
    this.quoteCache.clear();

    const pairDataList = Array.isArray(this.profitCalc.PAIR_DATA) ? this.profitCalc.PAIR_DATA : [];
    console.log(`🔍 Scanning ${pairDataList.length} pairs across 3 DEXes...\n`);

    for (const pairData of pairDataList) {
      if (!pairData || !pairData.token0 || !pairData.token1 || !pairData.amountInScaled) {
        console.warn('Skipping invalid pairData', pairData);
        continue;
      }

      let bestAero = 0n, bestUni = 0n, bestPancake = 0n;

      // Query each fee tier in parallel per fee (subject to provider limits)
      const feePromises = FEE_TIERS.map(async (fee) => {
        const [aQ, uQ, pQ] = await Promise.all([
          this.getQuote('AERO', pairData.token0, pairData.token1, fee, pairData.amountInScaled),
          this.getQuote('UNI', pairData.token0, pairData.token1, fee, pairData.amountInScaled),
          this.getQuote('PANCAKE', pairData.token0, pairData.token1, fee, pairData.amountInScaled)
        ]);
        return { fee, aQ, uQ, pQ };
      });

      const feeResults = await Promise.allSettled(feePromises);
      for (const settled of feeResults) {
        if (settled.status === 'fulfilled') {
          const { aQ, uQ, pQ } = settled.value;
          if (aQ > bestAero) bestAero = aQ;
          if (uQ > bestUni) bestUni = uQ;
          if (pQ > bestPancake) bestPancake = pQ;
        } else {
          console.warn('Fee batch failed', settled.reason && (settled.reason.message || settled.reason));
        }
      }

      const aeroPrice = this.formatPrice(bestAero, pairData.outDec);
      const uniPrice = this.formatPrice(bestUni, pairData.outDec);
      const pancakePrice = this.formatPrice(bestPancake, pairData.outDec);

      console.log(`📊 ${pairData.pair.padEnd(20)} | Aero: ${aeroPrice.toFixed(6).padEnd(12)} | Uni: ${uniPrice.toFixed(6).padEnd(12)} | PanCake: ${pancakePrice.toFixed(6).padEnd(12)}`);

      if (aeroPrice > 0 && uniPrice > 0 && pancakePrice > 0) {
        try {
          const profitAnalysis = this.profitCalc.findBestRoute({
            pair: pairData.pair,
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
        console.log('   ❌ Missing quotes (one or more DEXes returned zero)\n');
      }
    }

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
