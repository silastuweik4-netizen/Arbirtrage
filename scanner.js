const { ethers } = require('ethers');

const BASE_RPC = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com';
const provider = new ethers.JsonRpcProvider(BASE_RPC, { chainId: 8453, name: 'base' }, { staticNetwork: true });

// Real factory addresses on Base (verified)
const FACTORIES = {
  aerodrome: '0x420DD381B31aEf6683db6B902f2e9735d8e1f93B', // Aerodrome V2
  pancakeswap: '0x1F98431c8aD98523631AE4a59f267346ea31565f' // PancakeSwap V3
};

// Token addresses on Base
const TOKENS = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  USDbC: '0xd9aAEc86B65D86f6A7B630E2C953757eFB0d5E88',
  cbETH: '0x2Ae3F1eB1fC2e6d6d8D042C9D066bC06D9455358',
  DAI: '0x50c5725949A6F0c72E6C4a641F14122319976f97',
  AERO: '0x940181a94A35C424E6D2d6d8313e5E8ab37be8B0',
  VIRTUAL: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
  USDe: '0x4c9EDD5852cd905f23a3E8b3d3335fA2Fb6c66b4',
  DEGEN: '0x4ed4E1115d9e50E85617F3342551391D93F76445'
};

// ABIs
const FACTORY_V2_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  'function allPairs(uint) external view returns (address)',
  'function allPairsLength() external view returns (uint)'
];

const FACTORY_V3_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'
];

const PAIR_V2_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

const PAIR_V3_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function liquidity() external view returns (uint128)'
];

const V3_FEES = [100, 500, 2500, 3000, 10000];

class ArbitrageScanner {
  constructor() {
    this.aeroFactory = new ethers.Contract(FACTORIES.aerodrome, FACTORY_V2_ABI, provider);
    this.pancakeFactory = new ethers.Contract(FACTORIES.pancakeswap, FACTORY_V3_ABI, provider);
    this.requestCount = 0;
    this.opportunities = [];
  }

  async initialize() {
    try {
      const block = await provider.getBlockNumber();
      console.log(`\n✅ Arbitrage Scanner Initialized`);
      console.log(`📍 Block: ${block}`);
      console.log(`🏢 Factories:`);
      console.log(`   • Aerodrome (V2): ${FACTORIES.aerodrome}`);
      console.log(`   • PancakeSwap (V3): ${FACTORIES.pancakeswap}\n`);
    } catch (e) {
      console.error("❌ Connection failed:", e.message);
    }
  }

  /**
   * Get price from V2 pool (Aerodrome)
   */
  async getPriceFromV2Pool(pairAddress, token0, token1) {
    try {
      this.requestCount++;
      const pair = new ethers.Contract(pairAddress, PAIR_V2_ABI, provider);
      const reserves = await pair.getReserves();

      const pairToken0 = await pair.token0();
      let reserve0 = reserves[0];
      let reserve1 = reserves[1];

      if (pairToken0.toLowerCase() !== token0.toLowerCase()) {
        [reserve0, reserve1] = [reserve1, reserve0];
      }

      if (reserve0 === 0n || reserve1 === 0n) {
        return null;
      }

      const price = Number(reserve1) / Number(reserve0);
      return { price, liquidity: reserve0.toString() };
    } catch (e) {
      return null;
    }
  }

  /**
   * Get price from V3 pool (PancakeSwap)
   */
  async getPriceFromV3Pool(poolAddress, token0, token1) {
    try {
      this.requestCount++;
      const pool = new ethers.Contract(poolAddress, PAIR_V3_ABI, provider);
      const [slot0, liquidity] = await Promise.all([
        pool.slot0(),
        pool.liquidity()
      ]);

      if (liquidity === 0n) {
        return null;
      }

      const sqrtPrice = parseFloat(slot0.sqrtPriceX96.toString());
      const price = (sqrtPrice / Math.pow(2, 96)) ** 2;

      return { price, liquidity: liquidity.toString() };
    } catch (e) {
      return null;
    }
  }

  /**
   * Find pools and get prices for a pair
   */
  async findAndPricePair(token0, token1, token0Name, token1Name) {
    const prices = {};

    // Try Aerodrome V2
    try {
      this.requestCount++;
      const aeroPool = await this.aeroFactory.getPair(token0, token1);
      if (aeroPool !== ethers.ZeroAddress) {
        const priceData = await this.getPriceFromV2Pool(aeroPool, token0, token1);
        if (priceData) {
          prices.aerodrome = priceData.price;
        }
      }
    } catch (e) {
      // Pool doesn't exist
    }

    // Try PancakeSwap V3 (multiple fee tiers)
    for (const fee of V3_FEES) {
      try {
        this.requestCount++;
        const panPool = await this.pancakeFactory.getPool(token0, token1, fee);
        if (panPool !== ethers.ZeroAddress) {
          const priceData = await this.getPriceFromV3Pool(panPool, token0, token1);
          if (priceData) {
            prices.pancakeswap = priceData.price;
            break;
          }
        }
      } catch (e) {
        // Try next fee tier
      }
    }

    return prices;
  }

  /**
   * Main scan function
   */
  async scanForArbitrageOpportunities() {
    this.requestCount = 0;
    this.opportunities = [];

    const pairsToScan = [
      [TOKENS.WETH, TOKENS.USDC, 'WETH', 'USDC'],
      [TOKENS.WETH, TOKENS.USDbC, 'WETH', 'USDbC'],
      [TOKENS.USDC, TOKENS.DAI, 'USDC', 'DAI'],
      [TOKENS.WETH, TOKENS.cbETH, 'WETH', 'cbETH'],
      [TOKENS.USDC, TOKENS.USDbC, 'USDC', 'USDbC'],
      [TOKENS.AERO, TOKENS.WETH, 'AERO', 'WETH'],
      [TOKENS.VIRTUAL, TOKENS.USDC, 'VIRTUAL', 'USDC'],
      [TOKENS.USDe, TOKENS.USDC, 'USDe', 'USDC'],
    ];

    console.log(`🔍 Scanning ${pairsToScan.length} pairs...\n`);

    for (const [token0, token1, name0, name1] of pairsToScan) {
      const pairName = `${name0}/${name1}`;
      console.log(`📊 ${pairName.padEnd(20)}`);

      const prices = await this.findAndPricePair(token0, token1, name0, name1);

      if (prices.aerodrome) {
        console.log(`   Aero (V2): ${prices.aerodrome.toFixed(8)}`);
      } else {
        console.log(`   Aero (V2): ❌ No pool`);
      }

      if (prices.pancakeswap) {
        console.log(`   PanCake (V3): ${prices.pancakeswap.toFixed(8)}`);
      } else {
        console.log(`   PanCake (V3): ❌ No pool`);
      }

      // Calculate spread
      if (prices.aerodrome && prices.pancakeswap) {
        const minPrice = Math.min(prices.aerodrome, prices.pancakeswap);
        const maxPrice = Math.max(prices.aerodrome, prices.pancakeswap);
        const spreadPercent = ((maxPrice - minPrice) / minPrice) * 100;
        const spreadBp = spreadPercent * 100;

        console.log(`   Spread: ${spreadPercent.toFixed(4)}% (${spreadBp.toFixed(1)} bp)`);
        
        if (spreadBp > 7) {
          console.log(`   ✅ OPPORTUNITY! Net profit: ${(spreadBp - 6).toFixed(1)} bp\n`);
          
          this.opportunities.push({
            pair: pairName,
            aeroPrice: prices.aerodrome,
            pancakePrice: prices.pancakeswap,
            spreadBp: spreadBp.toFixed(1),
            netProfit: (spreadBp - 6).toFixed(1),
            buyDex: prices.aerodrome < prices.pancakeswap ? 'Aerodrome' : 'PancakeSwap',
            sellDex: prices.aerodrome < prices.pancakeswap ? 'PancakeSwap' : 'Aerodrome'
          });
        } else {
          console.log(`   ℹ️  Too small: ${spreadBp.toFixed(1)} bp\n`);
        }
      } else {
        console.log(`   ⚠️  Insufficient data\n`);
      }
    }

    // Summary
    console.log(`${'='.repeat(80)}`);
    console.log(`📊 SCAN SUMMARY`);
    console.log(`Opportunities: ${this.opportunities.length}`);
    console.log(`RPC Calls: ${this.requestCount}`);
    console.log(`${'='.repeat(80)}\n`);

    if (this.opportunities.length > 0) {
      console.log(`🏆 PROFITABLE OPPORTUNITIES:\n`);
      this.opportunities.sort((a, b) => parseFloat(b.netProfit) - parseFloat(a.netProfit));
      this.opportunities.forEach((opp, i) => {
        console.log(`${i + 1}. ${opp.pair}`);
        console.log(`   Spread: ${opp.spreadBp} bp | Net: ${opp.netProfit} bp`);
        console.log(`   BUY: ${opp.buyDex} @ ${(opp.aeroPrice < opp.pancakePrice ? opp.aeroPrice : opp.pancakePrice).toFixed(8)}`);
        console.log(`   SELL: ${opp.sellDex} @ ${(opp.aeroPrice > opp.pancakePrice ? opp.aeroPrice : opp.pancakePrice).toFixed(8)}\n`);
      });
    }

    return this.opportunities;
  }
}

module.exports = ArbitrageScanner;
