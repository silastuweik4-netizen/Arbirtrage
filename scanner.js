const { ethers } = require('ethers');
require('dotenv').config();

// ===== CONFIGURATION =====
const BASE_RPC = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY';

const CONFIG = {
  factories: {
    aerodrome: '0x420dd381b31aef6683db6b902f2e9735d8e1f93b',
    pancakeswap: '0x1b81d678ffb9c0263b24a97847620d99ee213e63'
  },
  quoter: {
    pancakeswap: '0xb048bbc1ee6b733fffcfb9e9cef7375518e25997'
  }
};

// Aerodrome Pair ABI (direct reserves)
const AERODROME_PAIR_ABI = [
  'function getReserves() external view returns (uint256 reserve0, uint256 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)'
];

// ===== TOKEN DEFINITIONS =====
const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH' },
  USDC: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, symbol: 'USDC' },
  DAI: { address: '0x50c5725949a6f0c72e6c4a641f14122319976f97', decimals: 18, symbol: 'DAI' },
  cbETH: { address: '0x2ae3f1eb1fc2e6d6d8d042c9d066bc06d9455358', decimals: 18, symbol: 'cbETH' },
  AERO: { address: '0x940181a94a35c424e6d2d6d8313e5e8ab37be8b0', decimals: 18, symbol: 'AERO' }
};

// ===== MAIN SCANNER CLASS =====
class ArbitrageScanner {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(BASE_RPC, { chainId: 8453, name: 'base' });
    this.requestCount = 0;
  }

  async initialize() {
    const block = await this.provider.getBlockNumber();
    return { block, factories: CONFIG.factories };
  }

  async getAerodromePrice(token0, token1) {
    try {
      this.requestCount++;
      
      // Check if pool exists
      const factory = new ethers.Contract(CONFIG.factories.aerodrome, [
        'function getPair(address tokenA, address tokenB) external view returns (address pair)'
      ], this.provider);
      
      const pairAddress = await factory.getPair(token0.address, token1.address);
      
      if (pairAddress === ethers.ZeroAddress) {
        console.log(`   Aerodrome: ❌ No pool`);
        return null;
      }

      // Get reserves from pair contract
      const pair = new ethers.Contract(pairAddress, AERODROME_PAIR_ABI, this.provider);
      const reserves = await pair.getReserves();
      const token0Address = await pair.token0();
      
      let [reserve0, reserve1] = [reserves[0], reserves[1]];
      if (token0Address.toLowerCase() !== token0.address.toLowerCase()) {
        [reserve0, reserve1] = [reserve1, reserve0];
      }

      if (reserve0 === 0n) {
        console.log(`   Aerodrome: ❌ Zero liquidity`);
        return null;
      }

      const price = Number(reserve1) / Number(reserve0);
      return { price, dex: 'Aerodrome' };
    } catch (e) {
      if (e.message.includes('CALL_EXCEPTION')) {
        console.log(`   Aerodrome: ❌ No pool`);
      } else {
        console.error(`❌ Aerodrome error: ${e.message.substring(0, 60)}`);
      }
      return null;
    }
  }

  async getPancakeSwapPrice(token0, token1) {
    try {
      this.requestCount++;
      
      const factory = new ethers.Contract(CONFIG.factories.pancakeswap, [
        'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'
      ], this.provider);
      
      const quoter = new ethers.Contract(CONFIG.quoter.pancakeswap, [
        'function quoteExactInputSingle((address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)'
      ], this.provider);

      for (const fee of [500, 3000, 10000]) {
        try {
          const pool = await factory.getPool(token0.address, token1.address, fee);
          if (pool === ethers.ZeroAddress) continue;
          
          const amountIn = ethers.parseUnits('1', token0.decimals);
          const params = {
            tokenIn: token0.address,
            tokenOut: token1.address,
            fee,
            amountIn,
            sqrtPriceLimitX96: 0
          };
          
          const [amountOut] = await quoter.quoteExactInputSingle(params);
          const price = Number(amountOut) / Math.pow(10, token1.decimals);
          
          return { price, dex: `PancakeSwap ${fee/10000}%` };
        } catch (e) {
          continue;
        }
      }
      
      console.log(`   PancakeSwap: ❌ No pool`);
      return null;
    } catch (e) {
      console.error(`❌ PancakeSwap error: ${e.message.substring(0, 60)}`);
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

    if (spread > 0.3) {
      const netProfit = spread - 0.3;
      console.log(`   ✅ OPPORTUNITY! Net: ${netProfit.toFixed(4)}%\n`);
      
      return {
        pair: pairName,
        spreadPercent: spread.toFixed(4),
        spreadBp: spreadBp.toFixed(1),
        netProfit: netProfit.toFixed(4),
        buyDex: aeroResult.price < cakeResult.price ? aeroResult.dex : cakeResult.dex,
        sellDex: aeroResult.price > cakeResult.price ? aeroResult.dex : cakeResult.dex
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
      [TOKENS.AERO, TOKENS.USDC]
    ];

    console.log(`🔍 Scanning ${pairs.length} pairs...\n`);
    const opportunities = [];

    for (const [token0, token1] of pairs) {
      const opp = await this.scanPair(token0, token1);
      if (opp) opportunities.push(opp);
      await new Promise(r => setTimeout(r, 150));
    }

    this.lastScanTime = Date.now() - startTime;
    
    console.log(`${'='.repeat(80)}`);
    console.log(`📊 SCAN SUMMARY`);
    console.log(`Opportunities: ${opportunities.length}`);
    console.log(`RPC Calls: ${this.requestCount}`);
    console.log(`Duration: ${this.lastScanTime}ms`);
    console.log(`${'='.repeat(80)}\n`);

    return opportunities;
  }

  getStats() {
    return {
      rpcCalls: this.requestCount,
      lastScanDuration: this.lastScanTime
    };
  }
}

// ===== EXPORT =====
module.exports = ArbitrageScanner;
