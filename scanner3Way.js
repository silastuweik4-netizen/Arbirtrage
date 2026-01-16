// threeWayScanner.js
const { ethers } = require('ethers');
const ThreeWayArbitrageCalculator = require('./threeWayArbitrageCalculator');

const RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com';
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 8453, name: 'base' });

const QUOTERS = {
  AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
  UNISWAP: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0", // verify this is correct
  PANCAKESWAP: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997"
};

const FEE_TIERS = [100, 500, 2500, 3000, 10000];
const QUOTER_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
];

class ThreeWayScanner {
  constructor() {
    this.aero = new ethers.Contract(QUOTERS.AERODROME, QUOTER_ABI, provider);
    this.uniswap = new ethers.Contract(QUOTERS.UNISWAP, QUOTER_ABI, provider);
    this.pancake = new ethers.Contract(QUOTERS.PANCAKESWAP, QUOTER_ABI, provider);
    this.profitCalc = new ThreeWayArbitrageCalculator();
    this.requestCount = 0;
    this.opportunities = [];

    // token address config
    this.pairConfig = new Map([
      ['WETH/USDC', { token0: '0x4200000000000000000000000000000000000006', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', inDec: 18, outDec: 6 }],
      ['WETH/USDbC', { token0: '0x4200000000000000000000000000000000000006', token1: '0xd9aAEc86B65D86f6A7B630E2C953757eFB0d5E88', inDec: 18, outDec: 6 }],
      // … keep the rest of your pairs here
    ]);
  }

  buildPairDataFromConfig(defaultAmount = '1') {
    return Array.from(this.pairConfig.entries()).map(([pair, cfg]) => {
      const amountInScaled = ethers.parseUnits(defaultAmount, cfg.inDec);
      return {
        pair,
        token0: cfg.token0,
        token1: cfg.token1,
        amountInScaled,
        outDec: cfg.outDec ?? cfg.inDec
      };
    });
  }

  async initialize() {
    try {
      const block = await provider.getBlockNumber();
      // build live-quoteable PAIR_DATA
      this.profitCalc.PAIR_DATA = this.buildPairDataFromConfig('1'); // 1 unit of token0
      console.log(`\n✅ 3-Way Arbitrage Scanner Initialized`);
      console.log(`📍 Block: ${block}`);
      console.log(`🏢 DEXes: Aerodrome, Uniswap V3, PancakeSwap`);
      console.log(`📊 Pairs to scan: ${this.profitCalc.PAIR_DATA.length}\n`);
      console.log('PAIR_DATA sample:', this.profitCalc.PAIR_DATA.slice(0,5));
    } catch (e) {
      console.error("❌ Connection failed", e && (e.message || e));
    }
  }

  async getQuote(dex, tokenIn, tokenOut, fee, amountInScaled) {
    try {
      this.requestCount++;
      const contract = dex === 'PANCAKE' ? this.pancake : (dex === 'UNI' ? this.uniswap : this.aero);

      if (dex === 'PANCAKE' || dex === 'UNI') {
        const params = { tokenIn, tokenOut, amountIn: amountInScaled, fee, sqrtPriceLimitX96: 0 };
        const res = await contract.callStatic.quoteExactInputSingle(params);
        return BigInt(res.amountOut ?? res[0] ?? 0);
      } else {
        const path = ethers.solidityPacked(['address', 'uint24', 'address'], [tokenIn, fee, tokenOut]);
        const res = await contract.callStatic.quoteExactInput(path, amountInScaled);
        return BigInt(res.amountOut ?? res[0] ?? 0);
      }
    } catch (e) {
      console.warn(`getQuote error dex=${dex} tokenIn=${tokenIn} tokenOut=${tokenOut} fee=${fee}`, e && (e.message || e));
      return 0n;
    }
  }

  formatPrice(amount, decimals) {
    return amount > 0n ? parseFloat(ethers.formatUnits(amount, decimals)) : 0;
  }

  async scanForArbitrageOpportunities() {
    this.requestCount = 0;
    this.opportunities = [];

    const pairDataList = Array.isArray(this.profitCalc.PAIR_DATA) ? this.profitCalc.PAIR_DATA : [];
    console.log(`🔍 Scanning ${pairDataList.length} pairs across 3 DEXes...\n`);

    for (const pairData of pairDataList) {
      let bestAero = 0n, bestUni = 0n, bestPancake = 0n;

      for (const fee of FEE_TIERS) {
        const [aQ, uQ, pQ] = await Promise.all([
          this.getQuote('AERO', pairData.token0, pairData.token1, fee, pairData.amountInScaled),
          this.getQuote('UNI', pairData.token0, pairData.token1, fee, pairData.amountInScaled),
          this.getQuote('PANCAKE', pairData.token0, pairData.token1, fee, pairData.amountInScaled)
        ]);

        if (aQ > bestAero) bestAero = aQ;
        if (uQ > bestUni) bestUni = uQ;
        if (pQ > bestPancake) bestPancake = pQ;
      }

      const aeroPrice = this.formatPrice(bestAero, pairData.outDec);
      const uniPrice = this.formatPrice(bestUni, pairData.outDec);
      const pancakePrice = this.formatPrice(bestPancake, pairData.outDec);

      console.log(`📊 ${pairData.pair.padEnd(20)} | Aero: ${aeroPrice.toFixed(6).padEnd(12)} | Uni: ${uniPrice.toFixed(6).padEnd(12)} | PanCake: ${pancakePrice.toFixed(6).padEnd(12)}`);

      if (aeroPrice > 0 && uniPrice > 0 && pancakePrice > 0) {
        const profitAnalysis = this.profitCalc.findBestRoute({
          pair: pairData.pair,
          fee: pairData.fee,
          aero: aeroPrice,
          uni: uniPrice,
          pancake: pancakePrice
        });

        if (profitAnalysis.isProfitable) {
          const recommendation = this.profitCalc.getRecommendation(profitAnalysis.netBp);
          console.log(`   ${recommendation}`);
          console.log(`   Buy: ${profitAnalysis.buyDex} @ ${profitAnalysis.buyPrice.toFixed(6)} → Sell: ${profitAnalysis.sellDex} @ ${profitAnalysis.sellPrice.toFixed(6)}`);
          console.log(`   Profit: ${profitAnalysis.netBp} bp = $${profitAnalysis.profitPer100k}/100k = $${profitAnalysis.profitPer1M}/1M\n`);

          this.opportunities.push(profitAnalysis);
        } else {
          console.log(`   ❌ Not profitable: ${profitAnalysis.netBp} bp\n`);
        }
      }
    }

    console.log(`${'='.repeat(80)}`);
    console.log(`📊 SCAN SUMMARY`);
    console.log(`Profitable Opportunities: ${this.opportunities.length}`);
    console.log(`RPC Requests: ${this.requestCount}`);
    console.log(`${'='.repeat(80)}\n`);

    return this.opportunities;
  }
}

module.exports = ThreeWayScanner;
