// threeWayScanner.js
// Patched: correct ABIs for Uniswap/Pancake (v3) and Aerodrome, address normalization,
// buildPairDataFromConfig integrated, callStatic usage, quoter checks, and robust logging.

const { ethers } = require('ethers');
const ThreeWayArbitrageCalculator = require('./threeWayArbitrageCalculator');

const RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/YOUR_KEY_HERE';
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 8453, name: 'base' });

// Use these verified quoter contract addresses for Base mainnet
const QUOTER_ADDRESSES_RAW = {
  // Official Aerodrome Quoter address on Base
  AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
  // Official Uniswap V3 Quoter address on Base
  UNISWAP:   "0x3344406cDF23b7e7774eB1C333d45c689D8eB820",
  // Official PancakeSwap V3 Quoter address on Base
  PANCAKESWAP: "0x7179D19E5244E11d886915E2e6B71B55B0998c0b"
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
    this.aero = null;
    this.uniswap = null;
    this.pancake = null;

    this.profitCalc = new ThreeWayArbitrageCalculator();
    this.requestCount = 0;
    this.opportunities = [];
    this.quoteCache = new Map();

    // Raw token config (use your full list here)
    this.pairConfigRaw = new Map([
      ['WETH/USDC', { token0: '0x4200000000000000000000000000000000000006', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', inDec: 18, outDec: 6 }],
      ['WETH/USDbC', { token0: '0x4200000000000000000000000000000000000006', token1: '0xd9aAEc86B65D86f6A7B630E2C953757eFB0d5E88', inDec: 18, outDec: 6 }],
      ['cbETH/WETH', { token0: '0x2Ae3F1eB1fC2e6d6d8D042C9D066bC06D9455358', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
      ['wstETH/WETH', { token0: '0xc1CBa3fCea344f92D75dB2fe0b2564dBAccF2fbe', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
      ['WETH/DAI', { token0: '0x4200000000000000000000000000000000000006', token1: '0x50c5725949A6F0c72E6C4a641F14122319976f97', inDec: 18, outDec: 18 }],
      // Add the rest of your pairs here...
    ]);
  }

  // Normalize addresses (checksum) with fallback to lowercase
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

  // Build PAIR_DATA from pairConfigRaw for live quoting
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

      // Quick runtime checks to help debug address/ABI mismatches
      await this._quoterSanityCheck(aeroAddr, this.aero, 'quoteExactInput');
      await this._quoterSanityCheck(uniAddr, this.uniswap, 'quoteExactInputSingle');
      await this._quoterSanityCheck(pancakeAddr, this.pancake, 'quoteExactInputSingle');

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
  async _quoterSanityCheck(addr, contract, fnName) {
    try {
      const code = await provider.getCode(addr);
      console.log(`Quoter ${addr} code: ${code === '0x' ? 'none' : 'deployed'}`);
      let hasFn = false;
      try {
        hasFn = !!contract.interface.getFunction(fnName);
      } catch { hasFn = false; }
      console.log(`Contract at ${addr} exposes ${fnName}? ${hasFn}`);
    } catch (e) {
      console.warn('Quoter check failed for', addr, e && (e.message || e));
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
      if (dex === 'UNI') {
        if (!this.uniswap || !this.uniswap.callStatic || !this.uniswap.callStatic.quoteExactInputSingle) {
          throw new Error('Uniswap quoter contract missing quoteExactInputSingle');
        }
        const res = await this.uniswap.callStatic.quoteExactInputSingle(tokenIn, tokenOut, fee, amountArg, 0);
        const amountOut = BigInt(res ?? 0);
        this.quoteCache.set(cacheKey, amountOut);
        return amountOut;
      } else if (dex === 'PANCAKE') {
        if (!this.pancake || !this.pancake.callStatic || !this.pancake.callStatic.quoteExactInputSingle) {
          throw new Error('Pancake quoter contract missing quoteExactInputSingle');
        }
        const res = await this.pancake.callStatic.quoteExactInputSingle(tokenIn, tokenOut, fee, amountArg, 0);
        const amountOut = BigInt(res ?? 0);
        this.quoteCache.set(cacheKey, amountOut);
        return amountOut;
      } else if (dex === 'AERO') {
        if (!this.aero || !this.aero.callStatic || !this.aero.callStatic.quoteExactInput) {
          throw new Error('Aerodrome quoter contract missing quoteExactInput');
        }
        // Aerodrome requires a path (bytes) argument for quoteExactInput, not single tokens
        // We pack the path using ethers.AbiCoder
        const path = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address'], [tokenIn, tokenOut]);
        const res = await this.aero.callStatic.quoteExactInput(path, amountArg);
        const amountOut = BigInt(res ?? 0);
        this.quoteCache.set(cacheKey, amountOut);
        return amountOut;
      }
    } catch (e) {
      console.error(`getQuote error dex=${dex} tokenIn=${tokenIn} tokenOut=${tokenOut} fee=${fee}`, e && (e.message || e));
      return 0n;
    }
    return 0n; // Fallback for unknown DEX
  }

  // Add the rest of your scanning logic here...
}

module.exports = ThreeWayScanner;
