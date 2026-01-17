// threeWayScanner.js
// 2026-01-17 Updated: Corrected Base Mainnet Quoter Addresses & Implemented missing scan function.

const { ethers } = require('ethers');
const ThreeWayArbitrageCalculator = require('./threeWayArbitrageCalculator');

// Use environment variables for security; fallback to public provider for reference.
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 8453, name: 'base' });

// Official 2026 Verified Addresses for Base Mainnet
const QUOTER_ADDRESSES_RAW = {
  AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0", // Aerodrome Quoter
  UNISWAP:   "0x3344406cDF23b7e7774eB1C333d45c689D8eB820", // Uniswap V3 QuoterV2
  PANCAKESWAP: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" // PancakeSwap V3 QuoterV2
};

const V3_QUOTER_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
];

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
    this.quoteCache = new Map();
    
    this.pairConfigRaw = new Map([
      ['WETH/USDC', { token0: '0x4200000000000000000000000000000000000006', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', inDec: 18, outDec: 6 }],
      ['WETH/USDbC', { token0: '0x4200000000000000000000000000000000000006', token1: '0xd9aAEc86B65D86f6A7B630E2C953757eFB0d5E88', inDec: 18, outDec: 6 }],
      ['cbETH/WETH', { token0: '0x2Ae3F1eB1fC2e6d6d8D042C9D066bC06D9455358', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
      ['wstETH/WETH', { token0: '0xc1CBa3fCea344f92D75dB2fe0b2564dBAccF2fbe', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
      ['WETH/DAI', { token0: '0x4200000000000000000000000000000000000006', token1: '0x50c5725949A6F0c72E6C4a641F14122319976f97', inDec: 18, outDec: 18 }]
    ]);
  }

  async initialize(defaultAmount = '1') {
    const aeroAddr = QUOTER_ADDRESSES_RAW.AERODROME;
    const uniAddr = QUOTER_ADDRESSES_RAW.UNISWAP;
    const pancakeAddr = QUOTER_ADDRESSES_RAW.PANCAKESWAP;

    this.aero = new ethers.Contract(aeroAddr, AERODROME_QUOTER_ABI, provider);
    this.uniswap = new ethers.Contract(uniAddr, V3_QUOTER_ABI, provider);
    this.pancake = new ethers.Contract(pancakeAddr, V3_QUOTER_ABI, provider);

    this.profitCalc.PAIR_DATA = this.buildPairDataFromConfig(defaultAmount);
    console.log(`✅ Scanner Initialized on Base | Block: ${await provider.getBlockNumber()}`);
  }

  buildPairDataFromConfig(defaultAmount) {
    const list = [];
    for (const [pair, cfg] of this.pairConfigRaw.entries()) {
      list.push({
        pair,
        token0: ethers.getAddress(cfg.token0),
        token1: ethers.getAddress(cfg.token1),
        amountInScaled: ethers.parseUnits(defaultAmount, cfg.inDec),
        outDec: cfg.outDec
      });
    }
    return list;
  }

  async getQuote(dex, tokenIn, tokenOut, fee, amountIn) {
    const cacheKey = `${dex}:${tokenIn}:${tokenOut}:${fee}`;
    if (this.quoteCache.has(cacheKey)) return this.quoteCache.get(cacheKey);

    try {
      if (dex === 'AERO') {
        const path = ethers.solidityPacked(['address', 'address'], [tokenIn, tokenOut]);
        const amountOut = await this.aero.quoteExactInput(path, amountIn);
        this.quoteCache.set(cacheKey, amountOut);
        return amountOut;
      } else {
        const contract = dex === 'UNI' ? this.uniswap : this.pancake;
        // V3 QuoterV2 uses a params struct
        const params = { tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0 };
        const result = await contract.quoteExactInputSingle.staticCall(params);
        this.quoteCache.set(cacheKey, result.amountOut);
        return result.amountOut;
      }
    } catch (e) {
      return 0n;
    }
  }

  // CORE SCANNER METHOD (Fixed runtime error)
  async scanForArbitrageOpportunities() {
    this.quoteCache.clear();
    console.log("🔍 Scanning 3-Way Opportunities...");

    for (const pair of this.profitCalc.PAIR_DATA) {
      for (const fee of FEE_TIERS) {
        const quoteAero = await this.getQuote('AERO', pair.token0, pair.token1, fee, pair.amountInScaled);
        const quoteUni = await this.getQuote('UNI', pair.token0, pair.token1, fee, pair.amountInScaled);
        const quotePancake = await this.getQuote('PANCAKE', pair.token0, pair.token1, fee, pair.amountInScaled);

        if (quoteAero > 0n && quoteUni > 0n && quotePancake > 0n) {
           this.profitCalc.evaluate(pair, fee, { quoteAero, quoteUni, quotePancake });
        }
      }
    }
  }
}

module.exports = ThreeWayScanner;
