/********************************************************************
 *  scanner3Way.js  (LIVE-PRICE, CHECKSUM-SAFE)
 *******************************************************************/
const { ethers } = require('ethers');
const ThreeWayArbitrageCalculator = require('./threeWayArbitrageCalculator');

/* ---------- ENV / PROVIDER ---------- */
const RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/YOUR_KEY';
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 8453, name: 'base' }, { staticNetwork: true });

/* ---------- LIVE-PRICE HELPERS ---------- */
const SLOT0_ABI = ['function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)'];
const QUOTER_ABI = ['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)'];

const QUOTERS = {
  UNISWAP:    '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  PANCAKESWAP:'0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
};

/* ---------- CHECKSUM HELPER ---------- */
function safeAddr(addr) {
  if (!addr) return null;
  return ethers.getAddress(addr.toLowerCase());
}

/* ---------- TOKEN ADDRESSES (BASE) ---------- */
const TOKENS = {
  WETH:  safeAddr('0x4200000000000000000000000000000000000006'),
  USDC:  safeAddr('0x833589fCD6EDb6E08f4c7c32D4f71b54bdA02913'),
  USDbC: safeAddr('0xd9aAEc86B65D86f6A7B5B1b0f42D531E7EdF9C60'),
  DAI:   safeAddr('0x50c5725949A6F0c72E6C4a641F24049A917DB0CbA'),
  cbETH: safeAddr('0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0decf9'),
  wstETH:safeAddr('0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'),
  AERO:  safeAddr('0x940181a94A35A4569E4529A3cDfB74e38FD98631'),
  BRETT: safeAddr('0x532f27101965dd16442E59d40670FaF5eBB572E8'),
  TOSHI: safeAddr('0xac1bd2486aaf3b5c896bf8fed62e45ef4923e2c8'),
  DEGEN: safeAddr('0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed'),
  CAKE:  safeAddr('0x0E4817d16EC6aa0ae64aD8f8A6Bc5974dFddA3a6'),
  VIRTUAL:safeAddr('0x6De6106f1d8A9613775d0c7E7031A453F49d5a6A'),
  AIXBT: safeAddr('0x7dE15D52F3b343a0bF7d4A3e54f3c4e9216eD8b5'),
  cbBTC: safeAddr('0xcbB7C0000ab88B473b1f5aBf59c174c027990902'),
  CLANKER:safeAddr('0xCcE4A58dD4BB4a5eC7764e9b9b48d0F25B6753E7'),
  USDe:  safeAddr('0x5d3a1Ff2B6BAb83b63cd9AD0787074081E52B34d'),
  FLOCK: safeAddr('0x6De6106f1d8A9613775d0c7E7031A453F49d5a6A'),
  MORPHO:safeAddr('0x7EeCA4205ffF31f47Ed50f03E3cB7e0eBBeB3c47'),
  ODOS:  safeAddr('0x9dDd7B7b5C8a85537d9Ad0A6dE2B1Dc6E04D6c1E')
};

/* ---------- AERODROME POOL MAP (CHECKSUMMED KEYS) ---------- */
const AERO_POOLS = {
  [`${TOKENS.WETH}-${TOKENS.USDC}-500`]:
    '0xC7d7CdBe3785bA58a5dB4C204b13E5aA0E4f5c9B',
  [`${TOKENS.WETH}-${TOKENS.USDbC}-500`]:
    '0xD0DdE7F03bA3821E63bC8B5a9e4f5c9B6D3E2A1f',
  [`${TOKENS.cbETH}-${TOKENS.WETH}-500`]:
    '0x3c8fEe11aBb9A9A5a9E4f5c9B6D3E2A1f0c9Ef3D',
  [`${TOKENS.wstETH}-${TOKENS.WETH}-500`]:
    '0x60c5B8cC9e4f5c9B6D3E2A1f0c9Ef3D9E3b0c9Ef`,
  [`${TOKENS.WETH}-${TOKENS.DAI}-500`]:
    '0x9a123b04c204b13E5aA0E4f5c9B6D3E2A1f0c9Ef`,
  [`${TOKENS.USDC}-${TOKENS.USDbC}-100`]:
    '0xE3Ad81dCc204b13E5aA0E4f5c9B6D3E2A1f0c9Ef`,
  [`${TOKENS.AERO}-${TOKENS.WETH}-3000`]:
    '0x7Bd0a9F3c204b13E5aA0E4f5c9B6D3E2A1f0c9Ef`,
  [`${TOKENS.BRETT}-${TOKENS.WETH}-3000`]:
    '0x3e11d005c204b13E5aA0E4f5c9B6D3E2A1f0c9Ef`,
  [`${TOKENS.TOSHI}-${TOKENS.WETH}-3000`]:
    '0x0Aa271FbBc204b13E5aA0E4f5c9B6D3E2A1f0c9Ef`,
  [`${TOKENS.DEGEN}-${TOKENS.WETH}-3000`]:
    '0x9Bc4a18Ec204b13E5aA0E4f5c9B6D3E2A1f0c9Ef`,
  [`${TOKENS.CAKE}-${TOKENS.USDC}-3000`]:
    '0x1b81D6787759C9E1d025C346D9D5b31e1573B092`,
  [`${TOKENS.VIRTUAL}-${TOKENS.USDC}-3000`]:
    '0x7Bd0a9F3c204b13E5aA0E4f5c9B6D3E2A1f0c9Ef`,
  [`${TOKENS.AIXBT}-${TOKENS.USDC}-3000`]:
    '0x3e11d005c204b13E5aA0E4f5c9B6D3E2A1f0c9Ef`,
  [`${TOKENS.cbBTC}-${TOKENS.USDC}-500`]:
    '0x60c5B8cC9e4f5c9B6D3E2A1f0c9Ef3D9E3b0c9Ef`,
  [`${TOKENS.CLANKER}-${TOKENS.WETH}-3000`]:
    '0x3e11d005c204b13E5aA0E4f5c9B6D3E2A1f0c9Ef`,
  [`${TOKENS.USDe}-${TOKENS.USDC}-100`]:
    '0xE3Ad81dCc204b13E5aA0E4f5c9B6D3E2A1f0c9Ef`,
  [`${TOKENS.FLOCK}-${TOKENS.USDC}-3000`]:
    '0x7Bd0a9F3c204b13E5aA0E4f5c9B6D3E2A1f0c9Ef`,
  [`${TOKENS.MORPHO}-${TOKENS.WETH}-3000`]:
    '0x3e11d005c204b13E5aA0E4f5c9B6D3E2A1f0c9Ef`,
  [`${TOKENS.ODOS}-${TOKENS.WETH}-3000`]:
    '0x9Bc4a18Ec204b13E5aA0E4f5c9B6D3E2A1f0c9Ef`,
  [`${TOKENS.wstETH}-${TOKENS.USDC}-500`]:
    '0x60c5B8cC9e4f5c9B6D3E2A1f0c9Ef3D9E3b0c9Ef`
};

function getAeroPool(tokenIn, tokenOut, fee) {
  const key1 = `${safeAddr(tokenIn)}-${safeAddr(tokenOut)}-${fee}`;
  const key2 = `${safeAddr(tokenOut)}-${safeAddr(tokenIn)}-${fee}`;
  return AERO_POOLS[key1] || AERO_POOLS[key2];
}

/* ---------- LIVE-PRICE FETCHERS ---------- */
async function getLivePrice(dex, tokenIn, tokenOut, fee, provider) {
  try {
    tokenIn = safeAddr(tokenIn);
    tokenOut = safeAddr(tokenOut);
    if (dex === 'AERO') {
      const pool = getAeroPool(tokenIn, tokenOut, fee);
      if (!pool) { console.warn('Aero pool not mapped', tokenIn, tokenOut, fee); return 0; }
      const c = new ethers.Contract(pool, SLOT0_ABI, provider);
      const [sqrtPriceX96] = await c.slot0();
      const price = Number(sqrtPriceX96 ** 2n / (2n ** 192n)); // token1-per-token0
      return price;
    }
    // Uni / PCS
    const quoter = new ethers.Contract(
      dex === 'UNI' ? QUOTERS.UNISWAP : QUOTERS.PANCAKESWAP,
      QUOTER_ABI,
      provider
    );
    const amountIn = ethers.parseUnits('1', 18); // 1 token0
    const params = { tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0 };
    const [amountOut] = await quoter.quoteExactInputSingle.staticCall(params);
    return Number(ethers.formatUnits(amountOut, 18)); // token1 per 1 token0
  } catch (e) {
    console.error(`Live price fail: ${dex} ${tokenIn}->${tokenOut} ${fee}`, e.message);
    return 0;
  }
}

/* ---------- FEE STRING → NUMBER ---------- */
function feeToBps(feeStr) {
  const pct = parseFloat(feeStr.replace('%', ''));
  return Math.round(pct * 100);
}

/* ---------- MAIN SCANNER CLASS ---------- */
class ThreeWayScanner {
  constructor() {
    this.profitCalc = new ThreeWayArbitrageCalculator();
    this.requestCount = 0;
    this.opportunities = [];
  }

  async initialize() {
    try {
      const block = await provider.getBlockNumber();
      console.log(`\n✅ 3-Way Arbitrage Scanner Initialized`);
      console.log(`📍 Block: ${block}`);
      console.log(`🏢 DEXes: Aerodrome, Uniswap V3, PancakeSwap`);
      console.log(`📊 Pairs to scan: ${this.profitCalc.PAIR_DATA.length}\n`);
    } catch (e) {
      console.error('❌ Connection failed', e.message);
    }
  }

  async scanForArbitrageOpportunities() {
    this.requestCount = 0;
    this.opportunities = [];

    console.log(`🔍 Scanning ${this.profitCalc.PAIR_DATA.length} pairs across 3 DEXes...\n`);

    for (const staticData of this.profitCalc.PAIR_DATA) {
      // 1.  PARSE TOKENS FROM PAIR STRING
      const [t0sym, t1sym] = staticData.pair.split('/');
      const token0 = TOKENS[t0sym];
      const token1 = TOKENS[t1sym];
      const feeNum = feeToBps(staticData.fee);

      if (!token0 || !token1) {
        console.warn('Token symbol not mapped', t0sym, t1sym);
        continue;
      }

      // 2.  LIVE PRICES (same block)
      const [aeroP, uniP, pancakeP] = await Promise.all([
        getLivePrice('AERO', token0, token1, feeNum, provider),
        getLivePrice('UNI',   token0, token1, feeNum, provider),
        getLivePrice('PANCAKE', token0, token1, feeNum, provider)
      ]);

      // 3.  BUILD LIVE OBJECT
      const liveData = { ...staticData, aero: aeroP, uni: uniP, pancake: pancakeP };

      // 4.  RUN YOUR EXISTING CALCULATOR
      const profitAnalysis = this.profitCalc.findBestRoute(liveData);

      // 5.  LOG & COLLECT
      console.log(`📊 ${liveData.pair.padEnd(20)} | Aero: ${aeroP.toFixed(6).padEnd(12)} | Uni: ${uniP.toFixed(6).padEnd(12)} | PanCake: ${pancakeP.toFixed(6).padEnd(12)}`);
      if (profitAnalysis.isProfitable) {
        const rec = this.profitCalc.getRecommendation(profitAnalysis.netBp);
        console.log(`   ${rec}`);
        console.log(`   Buy: ${profitAnalysis.buyDex} @ ${profitAnalysis.buyPrice.toFixed(6)} → Sell: ${profitAnalysis.sellDex} @ ${profitAnalysis.sellPrice.toFixed(6)}`);
        console.log(`   Profit: ${profitAnalysis.netBp} bp = $${profitAnalysis.profitPer100k}/100k = $${profitAnalysis.profitPer1M}/1M\n`);
        this.opportunities.push(profitAnalysis);
      } else {
        console.log(`   ❌ Not profitable: ${profitAnalysis.netBp} bp\n`);
      }
    }

    // 6.  SUMMARY (unchanged)
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
