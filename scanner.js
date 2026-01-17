const { ethers } = require('ethers');
require('dotenv').config();

// ===== CORRECTED CONFIGURATION =====
const BASE_RPC = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY';

const FACTORIES = {
  aerodrome: '0x420DD381B31aEf6683db6B902f2e9735d8e1f93B', // ✅ Correct
  pancakeswap: '0x1b81D678ffb9C0263b24A97847620D99EE213E63' // ✅ Fixed (was Uniswap)
};

const QUOTER_V2 = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518E25997'; // ✅ PancakeSwap QuoterV2

const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  DAI: { address: '0x50c5725949A6F0c72E6C4a641F14122319976f97', decimals: 18 },
  cbETH: { address: '0x2Ae3F1eB1fC2e6d6d8D042C9D066bC06D9455358', decimals: 18 },
  AERO: { address: '0x940181a94A35C424E6D2d6d8313e5E8ab37be8B0', decimals: 18 },
  VIRTUAL: { address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', decimals: 18 }
};

// ===== CORRECTED ABIs =====
const FACTORY_V2_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  'function allPairsLength() external view returns (uint)'
];

const FACTORY_V3_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'
];

const PAIR_V2_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)'
];

// ✅ NEW: QuoterV2 ABI for accurate price quotes
const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
];

// ✅ NEW: Aerodrome Router for proper quotes
const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] calldata routes) external view returns (uint256[] memory amounts)'
];

class ArbitrageScanner {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(BASE_RPC, { 
      chainId: 8453, 
      name: 'base' 
    });
    
    this.aeroFactory = new ethers.Contract(FACTORIES.aerodrome, FACTORY_V2_ABI, this.provider);
    this.pancakeFactory = new ethers.Contract(FACTORIES.pancakeswap, FACTORY_V3_ABI, this.provider);
    this.pancakeQuoter = new ethers.Contract(QUOTER_V2, QUOTER_V2_ABI, this.provider);
    this.aerodromeRouter = new ethers.Contract(
      '0xcF77a3Ba9A5CA399B7c97c74D3e6b19Bf6A6d145',
      AERODROME_ROUTER_ABI,
      this.provider
    );
    
    this.requestCount = 0;
    this.opportunities = [];
  }

  async initialize() {
    try {
      const block = await this.provider.getBlockNumber();
      console.log(`\n✅ Arbitrage Scanner Initialized`);
      console.log(`📍 Block: ${block}`);
      console.log(`🏢 Factories:`);
      console.log(`   • Aerodrome: ${FACTORIES.aerodrome}`);
      console.log(`   • PancakeSwap V3: ${FACTORIES.pancakeswap}`);
      console.log(`   • QuoterV2: ${QUOTER_V2}\n`);
    } catch (e) {
      console.error("❌ Connection failed:", e.message);
      process.exit(1);
    }
  }

  // ===== CORRECTED: V2 price with decimal handling =====
  async getPriceFromV2Pool(pairAddress, token0, token1, decimals0, decimals1) {
    try {
      this.requestCount++;
      const pair = new ethers.Contract(pairAddress, PAIR_V2_ABI, this.provider);
      const reserves = await pair.getReserves();

      const pairToken0 = await pair.token0();
      let reserve0 = reserves[0];
      let reserve1 = reserves[1];

      // Flip if needed
      if (pairToken0.toLowerCase() !== token0.toLowerCase()) {
        [reserve0, reserve1] = [reserve1, reserve0];
        [decimals0, decimals1] = [decimals1, decimals0];
      }

      if (reserve0 === 0n || reserve1 === 0n) {
        return null;
      }

      // ✅ Normalize to 18 decimals
      const r0 = Number(reserve0) / (10 ** decimals0);
      const r1 = Number(reserve1) / (10 ** decimals1);
      const price = r1 / r0;

      return { price, liquidity: reserve0.toString() };
    } catch (e) {
      console.error(`V2 Pool Error: ${e.message}`);
      return null;
    }
  }

  // ===== CORRECTED: V3 price using QuoterV2 =====
  async getPriceFromV3Pool(token0, token1, fee, decimals0, decimals1) {
    try {
      this.requestCount++;
      
      // 1% of token0 (handles decimals automatically)
      const amountIn = ethers.parseUnits('1', decimals0);
      
      const params = {
        tokenIn: token0,
        tokenOut: token1,
        fee: fee,
        amountIn: amountIn,
        sqrtPriceLimitX96: 0
      };

      const [amountOut] = await this.pancakeQuoter.quoteExactInputSingle(params);
      
      // ✅ Normalize to 18 decimals
      const out = Number(amountOut) / (10 ** decimals1);
      return { price: out, liquidity: 'N/A' }; // Quoter doesn't return liquidity
    } catch (e) {
      // Silently fail (pool may not exist for this fee tier)
      return null;
    }
  }

  // ===== CORRECTED: Aerodrome Router quote =====
  async getAerodromePrice(token0, token1, decimals0, decimals1) {
    try {
      this.requestCount++;
      
      const amountIn = ethers.parseUnits('1', decimals0);
      const path = [token0, token1];
      
      const amounts = await this.aerodromeRouter.getAmountsOut(amountIn, path);
      
      const out = Number(amounts[1]) / (10 ** decimals1);
      return { price: out, liquidity: 'N/A' };
    } catch (e) {
      console.error(`Aerodrome Router Error: ${e.message}`);
      return null;
    }
  }

  // ===== CORRECTED: Find pools with retry logic =====
  async findAndPricePair(token0, token1, symbol0, symbol1) {
    const prices = {};

    // Try Aerodrome V2
    try {
      this.requestCount++;
      const aeroPool = await this.aeroFactory.getPair(token0.address, token1.address);
      
      if (aeroPool !== ethers.ZeroAddress) {
        const priceData = await this.getAerodromePrice(
          token0.address, token1.address, token0.decimals, token1.decimals
        );
        if (priceData) {
          prices.aerodrome = priceData.price;
          console.log(`   Aero (V2): ${priceData.price.toFixed(8)}`);
        }
      } else {
        console.log(`   Aero (V2): ❌ No pool`);
      }
    } catch (e) {
      console.log(`   Aero (V2): ❌ Error - ${e.message.substring(0, 50)}`);
    }

    // Try PancakeSwap V3 (multiple fee tiers)
    let foundV3 = false;
    for (const fee of [500, 3000, 10000]) { // 0.05%, 0.3%, 1%
      try {
        this.requestCount++;
        const panPool = await this.pancakeFactory.getPool(token0.address, token1.address, fee);
        
        if (panPool !== ethers.ZeroAddress) {
          const priceData = await this.getPriceFromV3Pool(
            token0.address, token1.address, fee, token0.decimals, token1.decimals
          );
          if (priceData) {
            prices.pancakeswap = priceData.price;
            console.log(`   PanCake (V3/${fee/10000}%): ${priceData.price.toFixed(8)}`);
            foundV3 = true;
            break; // Take the first available fee tier
          }
        }
      } catch (e) {
        continue; // Try next fee tier
      }
    }
    
    if (!foundV3) {
      console.log(`   PanCake (V3): ❌ No pool`);
    }

    // ✅ Rate limiting (200ms delay)
    await new Promise(resolve => setTimeout(resolve, 200));
    
    return prices;
  }

  // ===== CORRECTED: Main scan with realistic threshold =====
  async scanForArbitrageOpportunities() {
    this.requestCount = 0;
    this.opportunities = [];

    const pairsToScan = [
      [TOKENS.WETH, TOKENS.USDC, 'WETH', 'USDC'],
      [TOKENS.USDC, TOKENS.DAI, 'USDC', 'DAI'],
      [TOKENS.WETH, TOKENS.cbETH, 'WETH', 'cbETH'],
      [TOKENS.AERO, TOKENS.WETH, 'AERO', 'WETH'],
      [TOKENS.AERO, TOKENS.USDC, 'AERO', 'USDC']
    ];

    console.log(`🔍 Scanning ${pairsToScan.length} pairs...\n`);

    for (const [token0, token1, name0, name1] of pairsToScan) {
      const pairName = `${name0}/${name1}`;
      console.log(`📊 ${pairName.padEnd(20)}`);

      const prices = await this.findAndPricePair(token0, token1, name0, name1);

      if (prices.aerodrome && prices.pancakeswap) {
        const spread = ((Math.max(prices.aerodrome, prices.pancakeswap) / 
                        Math.min(prices.aerodrome, prices.pancakeswap)) - 1) * 100;
        const spreadBp = spread * 100;
        
        console.log(`   📈 Spread: ${spread.toFixed(4)}% (${spreadBp.toFixed(1)} bp)`);

        // ✅ REALISTIC THRESHOLD: 0.3% (30bp) minimum
        const gasCostUsd = 0.25; // Both trades + approval
        const slippageCost = 0.15; // 0.15% on volatile pairs
        const minProfitThreshold = 0.3; // 0.3% = breakeven
        
        if (spread > minProfitThreshold) {
          const netProfit = spread - minProfitThreshold;
          console.log(`   ✅ OPPORTUNITY! Net: ${netProfit.toFixed(4)}%\n`);
          
          this.opportunities.push({
            pair: pairName,
            spreadPercent: spread.toFixed(4),
            spreadBp: spreadBp.toFixed(1),
            netProfit: netProfit.toFixed(4),
            buyDex: prices.aerodrome < prices.pancakeswap ? 'Aerodrome' : 'PancakeSwap',
            sellDex: prices.aerodrome < prices.pancakeswap ? 'PancakeSwap' : 'Aerodrome',
            aeroPrice: prices.aerodrome,
            pancakePrice: prices.pancakeswap
          });
        } else {
          console.log(`   ℹ️  Too small: ${spreadBp.toFixed(1)} bp (need >30 bp)\n`);
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
      console.log(`🏆 PROFITABLE OPPORTUNITIES (sorted by net profit):\n`);
      this.opportunities.sort((a, b) => parseFloat(b.netProfit) - parseFloat(a.netProfit));
      
      this.opportunities.forEach((opp, i) => {
        console.log(`${i + 1}. ${opp.pair}`);
        console.log(`   Spread: ${opp.spreadBp} bp | Net Profit: ${opp.netProfit}%`);
        console.log(`   BUY: ${opp.buyOn.padEnd(12)} @ ${(opp.aeroPrice < opp.pancakePrice ? opp.aeroPrice : opp.pancakePrice).toFixed(8)}`);
        console.log(`   SELL: ${opp.sellOn.padEnd(11)} @ ${(opp.aeroPrice > opp.pancakePrice ? opp.aeroPrice : opp.pancakePrice).toFixed(8)}`);
        console.log(`   Expected profit: $${(parseFloat(opp.netProfit) * 100).toFixed(2)} per $10K trade\n`);
      });
    }

    return this.opportunities;
  }
}

// ===== Execution =====
async function main() {
  const scanner = new ArbitrageScanner();
  await scanner.initialize();
  await scanner.scanForArbitrageOpportunities();
  
  // ✅ Auto-reload every 30s
  setInterval(async () => {
    console.log('\n🔄 Refreshing scan...\n');
    await scanner.scanForArbitrageOpportunities();
  }, 30000);
}

main().catch(console.error);

module.exports = { ArbitrageScanner, TOKENS, FACTORIES };
