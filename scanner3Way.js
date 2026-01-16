/********************************************************************
 *  scanner3Way.js (2026 STABLE VERSION - BASE MAINNET)
 *******************************************************************/
const { ethers } = require('ethers');
const ThreeWayArbitrageCalculator = require('./threeWayArbitrageCalculator');

/* ---------- ENV / PROVIDER ---------- */
const RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com';
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 8453, name: 'base' }, { staticNetwork: true });

/* ---------- ABIs ---------- */
// Aerodrome Slipstream slot0 does NOT include feeProtocol
const SLOT0_ABI = ['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)'];
const FACTORY_ABI = ['function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)'];
const QUOTER_ABI = ['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)'];

/* ---------- CONTRACTS (BASE 2026) ---------- */
const ADDRESSES = {
  UNISWAP_QUOTER: '0x222ca98f00ed15b1fae10b61c277703a194cf5d2', // QuoterV2
  PANCAKE_QUOTER: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
  AERO_FACTORY:   '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A', // Slipstream Factory
};

/* ---------- TOKEN CONFIG ---------- */
function safeAddr(addr) { return ethers.getAddress(addr.toLowerCase()); }

const TOKENS = {
  WETH:  { addr: safeAddr('0x4200000000000000000000000000000000000006'), dec: 18 },
  USDC:  { addr: safeAddr('0x833589fCD6EDb6E08f4c7c32D4f71b54bdA02913'), dec: 6  },
  USDbC: { addr: safeAddr('0xd9aAEc86B65D86f6A7B5B1b0f42D531E7EdF9C60'), dec: 6  },
  AERO:  { addr: safeAddr('0x940181a94A35A4569E4529A3cDfB74e38FD98631'), dec: 18 },
  cbBTC: { addr: safeAddr('0xcbB7C0000ab88B473b1f5aBf59c174c027990902'), dec: 8  }
  // Add other tokens following the same { addr, dec } pattern
};

/* ---------- DYNAMIC POOL CACHE ---------- */
const poolCache = {};

/* ---------- LIVE-PRICE FETCHERS ---------- */
async function getLivePrice(dex, tInSym, tOutSym, feeBps, provider) {
  try {
    const tIn = TOKENS[tInSym];
    const tOut = TOKENS[tOutSym];
    if (!tIn || !tOut) return 0;

    if (dex === 'AERO') {
      const factory = new ethers.Contract(ADDRESSES.AERO_FACTORY, FACTORY_ABI, provider);
      // Aerodrome Slipstream uses TickSpacing. Common: 100bps fee = 200 tickSpacing
      const tickSpacing = feeBps / 5; 
      
      const cacheKey = `${tIn.addr}-${tOut.addr}-${tickSpacing}`;
      if (!poolCache[cacheKey]) {
        poolCache[cacheKey] = await factory.getPool(tIn.addr, tOut.addr, tickSpacing);
      }
      
      const poolAddr = poolCache[cacheKey];
      if (poolAddr === ethers.ZeroAddress) return 0;

      const poolContract = new ethers.Contract(poolAddr, SLOT0_ABI, provider);
      const [sqrtPriceX96] = await poolContract.slot0();
      
      // sqrtPriceX96 to human price: (sqrt / 2^96)^2 * 10^(decIn - decOut)
      let price = (Number(sqrtPriceX96) / 2**96)**2 * (10**(tIn.dec - tOut.dec));
      
      // Uniswap/Aero price is always Token1 per Token0. Adjust if our "In" is Token1
      if (tIn.addr.toLowerCase() > tOut.addr.toLowerCase()) {
          price = 1 / price;
      }
      return price;
    }

    // UNI / PANCAKE Quoter Logic
    const quoterAddr = dex === 'UNI' ? ADDRESSES.UNISWAP_QUOTER : ADDRESSES.PANCAKE_QUOTER;
    const quoter = new ethers.Contract(quoterAddr, QUOTER_ABI, provider);
    
    const amountIn = ethers.parseUnits('1', tIn.dec);
    const params = { tokenIn: tIn.addr, tokenOut: tOut.addr, amountIn, fee: feeBps, sqrtPriceLimitX96: 0 };
    
    const [amountOut] = await quoter.quoteExactInputSingle.staticCall(params);
    return Number(ethers.formatUnits(amountOut, tOut.dec));
    
  } catch (e) {
    console.error(`Price Error: ${dex} ${tInSym}/${tOutSym}: ${e.message}`);
    return 0;
  }
}

class ThreeWayScanner {
  constructor() {
    this.profitCalc = new ThreeWayArbitrageCalculator();
    this.opportunities = [];
  }

  async initialize() {
    const block = await provider.getBlockNumber();
    console.log(`\n✅ Arbitrage Scanner Live [Base 2026]`);
    console.log(`📍 Block: ${block} | Dexes: Aero Slipstream, UniV3, PancakeV3\n`);
  }

  async scan() {
    console.log(`--- New Scan: ${new Date().toLocaleTimeString()} ---`);
    
    for (const staticData of this.profitCalc.PAIR_DATA) {
      const [t0, t1] = staticData.pair.split('/');
      const feeBps = Math.round(parseFloat(staticData.fee.replace('%', '')) * 100);

      const [aeroP, uniP, pancakeP] = await Promise.all([
        getLivePrice('AERO', t0, t1, feeBps, provider),
        getLivePrice('UNI',  t0, t1, feeBps, provider),
        getLivePrice('PANCAKE', t0, t1, feeBps, provider)
      ]);

      const liveData = { ...staticData, aero: aeroP, uni: uniP, pancake: pancakeP };
      const analysis = this.profitCalc.findBestRoute(liveData);

      process.stdout.write(`Pair: ${staticData.pair.padEnd(12)} | A: ${aeroP.toFixed(4)} | U: ${uniP.toFixed(4)} | P: ${pancakeP.toFixed(4)}\r`);

      if (analysis.isProfitable) {
        console.log(`\n🚀 PROFIT: ${analysis.profitPercentage}% on ${staticData.pair}`);
        console.log(`   Route: Buy ${analysis.bestBuyDex} -> Sell ${analysis.bestSellDex}`);
        this.opportunities.push({ ...analysis, time: Date.now() });
      }
    }
    console.log(`\n--- Scan Complete ---\n`);
  }
}

// Execution
const scanner = new ThreeWayScanner();
scanner.initialize().then(() => {
  const run = async () => {
    await scanner.scan();
    setTimeout(run, 5000); // 5 second intervals
  };
  run();
});
