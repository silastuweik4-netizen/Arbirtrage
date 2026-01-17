// threeWayScanner.js
// Updated scanner with QuoterV2 ABI (tuple signature), Aerodrome ABI, normalized addresses,
// verified quoter addresses for Base, runtime diagnostics, and robust quoting.

const { ethers } = require('ethers');
const ThreeWayArbitrageCalculator = require('./threeWayArbitrageCalculator');

const RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/YOUR_KEY_HERE';
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 8453, name: 'base' });

// Verified quoter addresses (Base)
const QUOTER_ADDRESSES_RAW = {
  AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
  UNISWAP:  "0x3344406cDF23b7E7774Eb1C333D45C689D8eB820",
  PANCAKESWAP: "0x7179D19E5244E11d886915e2e6b71B55b0998c0b"
};

// QuoterV2 ABI (tuple-based quoteExactInputSingle and richer quoteExactInput)
const V3_QUOTER_ABI = [
  // QuoterV2: single-tuple input, returns (amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate)
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  // QuoterV2: multi-hop path returns richer tuple; first element is amountOut
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
];

// Aerodrome Quoter ABI (path-based)
const AERODROME_QUOTER_ABI = [
  "function quoteExactInput(bytes path, uint256 amountIn) external view returns (uint256 amountOut)",
  "function quoteExactOutput(bytes path, uint256 amountOut) external view returns (uint256 amountIn)"
];

const FEE_TIERS = [100, 500, 2500, 3000, 10000];

class ThreeWayScanner {
  constructor() {
    this.aero = null;
    this.uniswap = null;
    this.pancake = null;

    this.profitCalc = new ThreeWayArbitrageCalculator();
    this.requestCount = 0;
    this.opportunities = [];
    this.quoteCache = new Map();

    // Raw token config (extend with your full list)
    this.pairConfigRaw = new Map([
      ['WETH/USDC', { token0: '0x4200000000000000000000000000000000000006', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', inDec: 18, outDec: 6 }],
      ['WETH/USDbC', { token0: '0x4200000000000000000000000000000000000006', token1: '0xd9aAEc86B65D86f6A7B630E2C953757eFB0d5E88', inDec: 18, outDec: 6 }],
      ['cbETH/WETH', { token0: '0x2Ae3F1eB1fC2e6d6d8D042C9D066bC06D9455358', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
      ['wstETH/WETH', { token0: '0xc1CBa3fCea344f92D75dB2fe0b2564dBAccF2fbe', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
      ['WETH/DAI', { token0: '0x4200000000000000000000000000000000000006', token1: '0x50c5725949A6F0c72E6C4a641F14122319976f97', inDec: 18, outDec: 18 }],
      // Add the rest of your pairs here...
    ]);
  }

  // Normalize addresses (EIP-55 checksum) with lowercase fallback
  _normalizeAddress(addr) {
    try {
      return ethers.getAddress(addr);
    } catch (err) {
      try {
        return ethers.getAddress(String(addr).toLowerCase());
      } catch (e) {
        console.warn('Invalid address, cannot normalize:', addr, e && (e.message || e));
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

  // Create contract instances and run quick checks
  async initialize(defaultAmount = '1') {
    try {
      // Normalize quoter addresses
      const aeroAddr = this._normalizeAddress(QUOTER_ADDRESSES_RAW.AERODROME);
      const uniAddr = this._normalizeAddress(QUOTER_ADDRESSES_RAW.UNISWAP);
      const pancakeAddr = this._normalizeAddress(QUOTER_ADDRESSES_RAW.PANCAKESWAP);

      // Create contract instances with correct ABIs
      this.aero = new ethers.Contract(aeroAddr, AERODROME_QUOTER_ABI, provider);
      this.uniswap = new ethers.Contract(uniAddr, V3_QUOTER_ABI, provider);
      this.pancake = new ethers.Contract(pancakeAddr, V3_QUOTER_ABI, provider);

      // Sanity checks
      await this._quoterSanityCheck('AERODROME', aeroAddr, this.aero, 'quoteExactInput');
      await this._quoterSanityCheck('UNISWAP', uniAddr, this.uniswap, 'quoteExactInputSingle');
      await this._quoterSanityCheck('PANCAKE', pancakeAddr, this.pancake, 'quoteExactInputSingle');

      // Quick multi-DEX live test (one-shot)
      await this._quickMultiDexTest(aeroAddr, uniAddr, pancakeAddr);

      // Build PAIR_DATA for live quoting
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

  // Sanity check: code deployed and function exists in ABI
  async _quoterSanityCheck(name, addr, contract, fnName) {
    try {
      const code = await provider.getCode(addr);
      console.log(`${name} addr: ${addr}`);
      console.log(`${name} code: ${code === '0x' ? 'none' : 'deployed'}`);
      let hasFn = false;
      try { hasFn = !!contract.interface.getFunction(fnName); } catch { hasFn = false; }
      console.log(`${name} exposes ${fnName}? ${hasFn}`);
      if (code !== '0x') {
        const implSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
        const implRaw = await provider.getStorageAt(addr, implSlot);
        const implAddr = implRaw && implRaw !== '0x' ? ethers.getAddress('0x' + implRaw.slice(26)) : null;
        console.log(`${name} EIP-1967 impl: ${implAddr || 'none'}`);
      }
    } catch (e) {
      console.warn('Quoter sanity check failed for', name, e && (e.message || e));
    }
  }

  // Quick multi-DEX test to attempt one live quote per quoter
  async _quickMultiDexTest(aeroAddr, uniAddr, pancakeAddr) {
    try {
      const WETH = this._normalizeAddress('0x4200000000000000000000000000000000000006');
      const USDC = this._normalizeAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
      const amountIn = ethers.parseUnits('1', 18);

      // Aerodrome (path-based)
      try {
        const pathA = ethers.utils.solidityPack(['address','uint24','address'], [WETH, 500, USDC]);
        const outA = await this.aero.callStatic.quoteExactInput(pathA, amountIn);
        console.log('AERO_QUOTE_OK', ethers.formatUnits(outA, 6));
      } catch (e) {
        console.log('AERO_QUOTE_ERR', e && (e.message || String(e)));
      }

      // Uniswap V3 QuoterV2 (single - tuple)
      try {
        const singleArg = {
          tokenIn: WETH,
          tokenOut: USDC,
          amountIn: amountIn,
          fee: 500,
          sqrtPriceLimitX96: 0n
        };
        const resU = await this.uniswap.callStatic.quoteExactInputSingle(singleArg);
        const outU = resU && resU[0] ? resU[0] : 0n;
        console.log('UNI_QUOTE_OK', ethers.formatUnits(outU, 6));
      } catch (e) {
        console.log('UNI_QUOTE_ERR', e && (e.message || String(e)));
      }

      // PancakeSwap V3 QuoterV2 (single - tuple)
      try {
        const singleArgP = {
          tokenIn: WETH,
          tokenOut: USDC,
          amountIn: amountIn,
          fee: 500,
          sqrtPriceLimitX96: 0n
        };
        const resP = await this.pancake.callStatic.quoteExactInputSingle(singleArgP);
        const outP = resP && resP[0] ? resP[0] : 0n;
        console.log('PANCAKE_QUOTE_OK', ethers.formatUnits(outP, 6));
      } catch (e) {
        console.log('PANCAKE_QUOTE_ERR', e && (e.message || String(e)));
      }
    } catch (err) {
      console.warn('QUOTER_TEST_FATAL', err && (err.message || String(err)));
    }
  }

  _cacheKey(dex, tokenIn, tokenOut, fee, amountInScaled) {
    return `${dex}|${tokenIn}|${tokenOut}|${fee}|${amountInScaled.toString()}`;
  }

  // Get quote from quoter contracts. Returns BigInt amountOut or 0n on failure.
  async getQuote(dex, tokenIn, tokenOut, fee, amountInScaled) {
    if (!tokenIn || !tokenOut || amountInScaled === undefined || amountInScaled === null) {
      console.warn('getQuote: missing args', { dex, tokenIn, tokenOut, fee, amountInScaled });
      return 0n;
    }

    let amountArg;
    try {
      amountArg = typeof amountInScaled === 'bigint' ? amountInScaled : BigInt(amountInScaled.toString());
    } catch (err) {
      console.warn('getQuote: invalid amountInScaled', amountInScaled, err && (err.message || err));
      return 0n;
    }

    const cacheKey = this._cacheKey(dex, tokenIn, tokenOut, fee, amountArg);
    if (this.quoteCache.has(cacheKey)) return this.quoteCache.get(cacheKey);

    try {
      this.requestCount++;
      if (dex === 'UNI' || dex === 'PANCAKE') {
        const quoter = dex === 'UNI' ? this.uniswap : this.pancake;
        if (!quoter || !quoter.callStatic || !quoter.callStatic.quoteExactInputSingle) {
          throw new Error(`${dex} quoter contract missing quoteExactInputSingle`);
        }

        // Build the single-tuple argument expected by QuoterV2
        const singleArg = {
          tokenIn: tokenIn,
          tokenOut: tokenOut,
          amountIn: amountArg,
          fee: fee,
          sqrtPriceLimitX96: 0n
        };

        // callStatic returns a tuple: [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate]
        const res = await quoter.callStatic.quoteExactInputSingle(singleArg);
        const amountOut = BigInt((res && res[0]) ? res[0].toString() : 0);
        this.quoteCache.set(cacheKey, amountOut);
        return amountOut;
      } else {
        if (!this.aero || !this.aero.callStatic || !this.aero.callStatic.quoteExactInput) {
          throw new Error('Aerodrome quoter contract missing quoteExactInput');
        }
        const path = ethers.utils.solidityPack(['address', 'uint24', 'address'], [tokenIn, fee, tokenOut]);
        const res = await this.aero.callStatic.quoteExactInput(path, amountArg);
        const amountOut = BigInt(res ? res.toString() : 0);
        this.quoteCache.set(cacheKey, amountOut);
        return amountOut;
      }
    } catch (err) {
      console.warn(`getQuote error dex=${dex} tokenIn=${tokenIn} tokenOut=${tokenOut} fee=${fee}`, err && (err.message || err));
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
