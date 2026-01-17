const { ethers } = require('ethers');

const BASE_RPC = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com';
const provider = new ethers.JsonRpcProvider(BASE_RPC, { chainId: 8453, name: 'base' }, { staticNetwork: true });

// Known working pool addresses on Base (Aerodrome + PancakeSwap + Uniswap)
const POOL_ADDRESSES = {
  'WETH/USDC': {
    aerodrome: '0xCBCdF9B3A80017A9d0F6f2f063226fF24348cea8', // Aerodrome pool
    pancakeswap: '0x36696169C63e42cd08ce11f985dAFfB30B68ef12', // PancakeSwap v3 pool
    uniswap: null, // May not exist on Base
    fee: '0.05%'
  },
  'WETH/USDbC': {
    aerodrome: '0x7a0B36cb31b3e9c4e82d81e616b149abC5c89f45',
    pancakeswap: '0x11BD926226975128B980e8b6D127948b1Fc93e79',
    uniswap: null,
    fee: '0.05%'
  },
  'cbETH/WETH': {
    aerodrome: '0x9a9d920f0675a0Fc6f553340b0e69752e6026666',
    pancakeswap: '0x7d1f47c6fcAd45aA92f5EeD1aF9dEd7e66CA66D3',
    uniswap: null,
    fee: '0.05%'
  },
  'USDC/USDbC': {
    aerodrome: '0x11e39b0f17eee89e72262b5472b76D9DD4d71282',
    pancakeswap: '0x03a520b32C04Bf3bEFf917D195745F6637fE8352',
    uniswap: null,
    fee: '0.01%'
  },
  'USDe/USDC': {
    aerodrome: null,
    pancakeswap: '0x4e5a3B2cFf45d9e33B53F40d6B1BEd15b56e03Db',
    uniswap: null,
    fee: '0.01%'
  },
  'AERO/WETH': {
    aerodrome: '0x3d1a6bbb2db8b53f0ba1c2b12c0e14bd43f23ecd',
    pancakeswap: '0x9F30a65eCE8A0b0ef1d1Cbc2e4Ee9ff6E7C3D04E',
    uniswap: null,
    fee: '0.30%'
  },
  'VIRTUAL/USDC': {
    aerodrome: '0x1E80e06075d829705F71Bc41Cc0C1A5b55f93B61',
    pancakeswap: '0x56E83e87C4bEd8A1b4Fd9d693A4fF3d5BAB48525',
    uniswap: null,
    fee: '0.30%'
  },
  'DEGEN/WETH': {
    aerodrome: '0xb6Bc6FEc63f7Cd9F7Ac9fFEaa937B9a5Fb6CBfD2',
    pancakeswap: null,
    uniswap: null,
    fee: '0.30%'
  }
};

// V3 Pool ABI (getSlot0 returns price data)
const V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function liquidity() external view returns (uint128)'
];

// V2 Pool ABI (getReserves)
const V2_POOL_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

class WorkingArbitrageScanner {
  constructor() {
    this.requestCount = 0;
    this.opportunities = [];
  }

  async initialize() {
    try {
      const block = await provider.getBlockNumber();
      console.log(`\n✅ Direct Pool Scanner Initialized`);
      console.log(`📍 Block: ${block}`);
      console.log(`🏢 DEXes: Aerodrome (V2), PancakeSwap (V3), Uniswap (V3)`);
      console.log(`📊 Pairs configured: ${Object.keys(POOL_ADDRESSES).length}\n`);
    } catch (e) {
      console.error("❌ Connection failed:", e.message);
    }
  }

  /**
   * Get price from V3 pool using sqrtPriceX96
   */
  async getPriceFromV3Pool(poolAddress) {
    try {
      this.requestCount++;
      const pool = new ethers.Contract(poolAddress, V3_POOL_ABI, provider);
      const [token0, token1, slot0, liquidity] = await Promise.all([
        pool.token0(),
        pool.token1(),
        pool.slot0(),
        pool.liquidity()
      ]);

      // Convert sqrtPriceX96 to price
      // price = (sqrtPriceX96 / 2^96)^2
      const sqrtPrice = parseFloat(slot0.sqrtPriceX96.toString());
      const price = (sqrtPrice / Math.pow(2, 96)) ** 2;

      return {
        price: price,
        token0: token0,
        token1: token1,
        liquidity: liquidity.toString(),
        isValid: liquidity > 0n
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Get price from V2 pool using reserves
   */
  async getPriceFromV2Pool(poolAddress) {
    try {
      this.requestCount++;
      const pool = new ethers.Contract(poolAddress, V2_POOL_ABI, provider);
      const [token0, token1, reserves] = await Promise.all([
        pool.token0(),
        pool.token1(),
        pool.getReserves()
      ]);

      // price = reserve1 / reserve0
      const price = Number(reserves[1]) / Number(reserves[0]);

      return {
        price: price,
        token0: token0,
        token1: token1,
        reserves: { reserve0: reserves[0].toString(), reserve1: reserves[1].toString() },
        isValid: reserves[0] > 0n && reserves[1] > 0n
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Scan all configured pairs
   */
  async scanForArbitrageOpportunities() {
    this.requestCount = 0;
    this.opportunities = [];

    console.log(`🔍 Scanning ${Object.keys(POOL_ADDRESSES).length} pairs...\n`);

    for (const [pairName, pools] of Object.entries(POOL_ADDRESSES)) {
      console.log(`📊 ${pairName.padEnd(20)}`);

      const prices = {
        aerodrome: null,
        pancakeswap: null,
        uniswap: null
      };

      // Get Aerodrome price (V2)
      if (pools.aerodrome) {
        const aeroData = await this.getPriceFromV2Pool(pools.aerodrome);
        if (aeroData && aeroData.isValid) {
          prices.aerodrome = aeroData.price;
          console.log(`   Aero (V2): ${aeroData.price.toFixed(8)}`);
        } else {
          console.log(`   Aero (V2): ❌ No liquidity`);
        }
      }

      // Get PancakeSwap price (V3)
      if (pools.pancakeswap) {
        const panData = await this.getPriceFromV3Pool(pools.pancakeswap);
        if (panData && panData.isValid) {
          prices.pancakeswap = panData.price;
          console.log(`   PanCake (V3): ${panData.price.toFixed(8)}`);
        } else {
          console.log(`   PanCake (V3): ❌ No liquidity`);
        }
      }

      // Get Uniswap price (V3)
      if (pools.uniswap) {
        const uniData = await this.getPriceFromV3Pool(pools.uniswap);
        if (uniData && uniData.isValid) {
          prices.uniswap = uniData.price;
          console.log(`   Uni (V3): ${uniData.price.toFixed(8)}`);
        } else {
          console.log(`   Uni (V3): ❌ No liquidity`);
        }
      }

      // Calculate spreads
      const validPrices = Object.entries(prices).filter(([_, p]) => p !== null);

      if (validPrices.length >= 2) {
        const priceArray = validPrices.map(([dex, price]) => ({ dex, price }));
        priceArray.sort((a, b) => a.price - b.price);

        const minPrice = priceArray[0].price;
        const maxPrice = priceArray[priceArray.length - 1].price;
        const spread = ((maxPrice - minPrice) / minPrice) * 100;
        const spreadBp = spread * 100;

        console.log(`   Spread: ${spread.toFixed(4)}% (${spreadBp.toFixed(1)} bp)`);
        console.log(`   BUY: ${priceArray[0].dex} @ ${minPrice.toFixed(8)}`);
        console.log(`   SELL: ${priceArray[priceArray.length - 1].dex} @ ${maxPrice.toFixed(8)}\n`);

        // Check if profitable (> 5bp after fees)
        if (spreadBp > 7) {
          this.opportunities.push({
            pair: pairName,
            spreadBp: spreadBp.toFixed(1),
            buyDex: priceArray[0].dex,
            buyPrice: minPrice,
            sellDex: priceArray[priceArray.length - 1].dex,
            sellPrice: maxPrice,
            netProfit: (spreadBp - 6).toFixed(1)
          });
        }
      } else {
        console.log(`   ⚠️  Insufficient price data\n`);
      }
    }

    // Summary
    console.log(`${'='.repeat(80)}`);
    console.log(`📊 SCAN SUMMARY`);
    console.log(`Opportunities Found: ${this.opportunities.length}`);
    console.log(`RPC Calls: ${this.requestCount}`);
    console.log(`${'='.repeat(80)}\n`);

    if (this.opportunities.length > 0) {
      console.log(`🏆 PROFITABLE OPPORTUNITIES:\n`);
      this.opportunities.sort((a, b) => parseFloat(b.netProfit) - parseFloat(a.netProfit));
      this.opportunities.forEach((opp, i) => {
        console.log(`${i + 1}. ${opp.pair}`);
        console.log(`   Spread: ${opp.spreadBp} bp | Net Profit: ${opp.netProfit} bp`);
        console.log(`   BUY: ${opp.buyDex} @ ${opp.buyPrice.toFixed(8)}`);
        console.log(`   SELL: ${opp.sellDex} @ ${opp.sellPrice.toFixed(8)}\n`);
      });
    }

    return this.opportunities;
  }
}

module.exports = WorkingArbitrageScanner;
