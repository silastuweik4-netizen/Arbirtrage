const { ethers } = require('ethers');
require('dotenv').config();

// ===== CONFIGURATION (All lowercase addresses) =====
const BASE_RPC = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY';

const CONFIG = {
  factories: {
    aerodrome: '0x420dd381b31aef6683db6b902f2e9735d8e1f93b',
    pancakeswap: '0x1b81d678ffb9c0263b24a97847620d99ee213e63'
  },
  quoter: {
    pancakeswap: '0xb048bbc1ee6b733fffcfb9e9cef7375518e25997'
  },
  router: {
    aerodrome: '0xcf77a3ba9a5ca399b7c97c74d3e6b19bf6a6d145'
  }
};

// ===== TOKEN DEFINITIONS =====
const TOKENS = {
  WETH: { 
    address: '0x4200000000000000000000000000000000000006', 
    decimals: 18, 
    symbol: 'WETH' 
  },
  USDC: { 
    address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 
    decimals: 6, 
    symbol: 'USDC' 
  },
  DAI: { 
    address: '0x50c5725949a6f0c72e6c4a641f14122319976f97', 
    decimals: 18, 
    symbol: 'DAI' 
  },
  cbETH: { 
    address: '0x2ae3f1eb1fc2e6d6d8d042c9d066bc06d9455358', 
    decimals: 18, 
    symbol: 'cbETH' 
  },
  AERO: { 
    address: '0x940181a94a35c424e6d2d6d8313e5e8ab37be8b0', 
    decimals: 18, 
    symbol: 'AERO' 
  },
  VIRTUAL: { 
    address: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b', 
    decimals: 18, 
    symbol: 'VIRTUAL' 
  }
};

// ===== ABIs =====
const FACTORY_V2_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)'
];

const FACTORY_V3_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'
];

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
];

const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] calldata routes) external view returns (uint256[] memory amounts)'
];

// ===== MAIN SCANNER CLASS =====
class ArbitrageScanner {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(BASE_RPC, {
      chainId: 8453,
      name: 'base'
    });
    
    this.requestCount = 0;
    this.lastScanTime = null;
  }

  async initialize() {
    const block = await this.provider.getBlockNumber();
    return {
      block,
      factories: CONFIG.factories,
      quoter: CONFIG.quoter,
      router: CONFIG.router
    };
  }

  async getAerodromePrice(token0, token1) {
    try {
      this.requestCount++;
      
      // Use token objects properly
      const t0 = token0.address;
      const t1 = token1.address;
      
      const router = new ethers.Contract(CONFIG.router.aerodrome, AERODROME_ROUTER_ABI, this.provider);
      const amountIn = ethers.parseUnits('1', token0.decimals);
      
      const amounts = await router.getAmountsOut(amountIn, [t0, t1]);
      const price = Number(amounts[1]) / Math.pow(10, token1.decimals);
      
      return { price, dex: 'Aerodrome' };
    } catch (e) {
      if (!e.message.includes('INSUFFICIENT_LIQUIDITY') && !e.message.includes('ReentrancyGuard')) {
        console.error(`❌ Aerodrome error for ${token0.symbol}/${token1.symbol}: ${e.message.substring(0, 60)}`);
      }
      return null;
    }
  }

  async getPancakeSwapPrice(token0, token1) {
    try {
      this.requestCount++;
      
      // Use token objects properly
      const t0 = token0.address;
      const t1 = token1.address;
      
      const factory = new ethers.Contract(CONFIG.factories.pancakeswap, FACTORY_V3_ABI, this.provider);
      const quoter = new ethers.Contract(CONFIG.quoter.pancakeswap, QUOTER_V2_ABI, this.provider);
      
      for (const fee of [500, 3000, 10000]) { // 0.05%, 0.3%, 1%
        try {
          const pool = await factory.getPool(t0, t1, fee);
          if (pool === ethers.ZeroAddress) continue;
          
          const amountIn = ethers.parseUnits('1', token0.decimals);
          const params = {
            tokenIn: t0,
            tokenOut: t1,
            fee,
            amountIn,
            sqrtPriceLimitX96: 0
          };
          
          const [amountOut] = await quoter.quoteExactInputSingle(params);
          const price = Number(amountOut) / Math.pow(10, token1.decimals);
          
          return { price, dex: `PancakeSwap V3 ${fee/10000}%` };
        } catch (e) {
          continue;
        }
      }
      return null;
    } catch (e) {
      console.error(`❌ PancakeSwap error for ${token0.symbol}/${token1.symbol}: ${e.message.substring(0, 60)}`);
      return null;
    }
  }

  async scanPair(token0, token1) {
    const pairName = `${token0.symbol}/${token1.symbol}`;
    console.log(`📊 ${pairName.padEnd(20)}`);

    const [aeroResult, cakeResult] = await Promise.all([
      this.getAerodromePrice(token0, token1),
      this.getPancakeSwapPrice(token0, token1)
    ]);

    if (!aeroResult || !cakeResult) {
      console.log(`   ❌ Insufficient data\n`);
      return null;
    }

    const spread = Math.abs(aeroResult.price - cakeResult.price) / aeroResult.price * 100;
    const spreadBp = spread * 100;
    
    console.log(`   ${aeroResult.dex.padEnd(15)}: ${aeroResult.price.toFixed(8)}`);
    console.log(`   ${cakeResult.dex.padEnd(15)}: ${cakeResult.price.toFixed(8)}`);
    console.log(`   📈 Spread: ${spread.toFixed(4)}% (${spreadBp.toFixed(1)} bp)`);

    // Only return if profitable (>0.3% after gas)
    if (spread > 0.3) {
      const netProfit = spread - 0.3;
      console.log(`   ✅ OPPORTUNITY! Net: ${netProfit.toFixed(4)}%\n`);
      
      return {
        pair: pairName,
        spreadPercent: spread.toFixed(4),
        spreadBp: spreadBp.toFixed(1),
        netProfit: netProfit.toFixed(4),
        buyDex: aeroResult.price < cakeResult.price ? aeroResult.dex : cakeResult.dex,
        sellDex: aeroResult.price > cakeResult.price ? aeroResult.dex : cakeResult.dex,
        aeroPrice: aeroResult.price,
        cakePrice: cakeResult.price
      };
    }
    
    console.log(`   ℹ️  Too small: ${spreadBp.toFixed(1)} bp (need >30 bp)\n`);
    return null;
  }

  async scanAll() {
    this.requestCount = 0;
    const startTime = Date.now();

    const pairs = [
      [TOKENS.WETH, TOKENS.USDC],
      [TOKENS.USDC, TOKENS.DAI],
      [TOKENS.WETH, TOKENS.cbETH],
      [TOKENS.AERO, TOKENS.WETH],
      [TOKENS.AERO, TOKENS.USDC],
      [TOKENS.VIRTUAL, TOKENS.USDC]
    ];

    console.log(`🔍 Scanning ${pairs.length} pairs...\n`);

    const opportunities = [];
    for (const [token0, token1] of pairs) {
      const opp = await this.scanPair(token0, token1);
      if (opp) opportunities.push(opp);
      
      // Rate limiting between pairs
      await new Promise(r => setTimeout(r, 150));
    }

    this.lastScanTime = Date.now() - startTime;
    
    // Summary
    console.log(`${'='.repeat(80)}`);
    console.log(`📊 SCAN SUMMARY`);
    console.log(`Opportunities: ${opportunities.length}`);
    console.log(`RPC Calls: ${this.requestCount}`);
    console.log(`Duration: ${this.lastScanTime}ms`);
    console.log(`${'='.repeat(80)}\n`);

    if (opportunities.length > 0) {
      console.log(`🏆 PROFITABLE OPPORTUNITIES:\n`);
      opportunities.sort((a, b) => parseFloat(b.netProfit) - parseFloat(a.netProfit));
      
      opportunities.forEach((opp, i) => {
        console.log(`${i + 1}. ${opp.pair}`);
        console.log(`   Spread: ${opp.spreadBp} bp | Net Profit: ${opp.netProfit}%`);
        console.log(`   BUY: ${opp.buyDex}`);
        console.log(`   SELL: ${opp.sellDex}`);
        console.log(`   Expected: $${(parseFloat(opp.netProfit) * 100).toFixed(2)} per $10K\n`);
      });
    }

    return opportunities;
  }

  getStats() {
    return {
      rpcCalls: this.requestCount,
      lastScanDuration: this.lastScanTime
    };
  }
}

// ===== EXPORT THE CLASS =====
module.exports = ArbitrageScanner;
