const { ethers } = require('ethers');
require('dotenv').config();

// ===== CONFIGURATION =====
const BASE_RPC = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY';

const CONFIG = {
  factories: {
    aerodrome: '0x420DD381B31aEf6683db6B902f2e9735d8e1f93B',
    pancakeswap: '0x1b81D678ffb9C0263b24A97847620D99EE213E63'
  },
  quoter: {
    pancakeswap: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518E25997'
  },
  router: {
    aerodrome: '0xcF77a3Ba9A5CA399B7c97c74D3e6b19Bf6A6d145'
  }
};

// ===== TOKEN DEFINITIONS (WITH DECIMALS) =====
const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH' },
  USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, symbol: 'USDC' },
  DAI: { address: '0x50c5725949A6F0c72E6C4a641F14122319976f97', decimals: 18, symbol: 'DAI' },
  cbETH: { address: '0x2Ae3F1eB1fC2e6d6d8D042C9D066bC06D9455358', decimals: 18, symbol: 'cbETH' },
  AERO: { address: '0x940181a94A35C424E6D2d6d8313e5E8ab37be8B0', decimals: 18, symbol: 'AERO' },
  VIRTUAL: { address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', decimals: 18, symbol: 'VIRTUAL' }
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

// ===== FIXED ARBITRAGE SCANNER CLASS =====
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
      quoter: CONFIG.quoter
    };
  }

  async getAerodromePrice(token0, token1) {
    try {
      this.requestCount++;
      
      // Normalize addresses
      const t0 = ethers.getAddress(token0.address);
      const t1 = ethers.getAddress(token1.address);
      
      const router = new ethers.Contract(CONFIG.router.aerodrome, AERODROME_ROUTER_ABI, this.provider);
      const amountIn = ethers.parseUnits('1', token0.decimals);
      
      const amounts = await router.getAmountsOut(amountIn, [t0, t1]);
      const price = Number(amounts[1]) / Math.pow(10, token1.decimals);
      
      return { price, dex: 'Aerodrome' };
    } catch (e) {
      if (!e.message.includes('INSUFFICIENT_LIQUIDITY')) {
        console.error(`❌ Aerodrome error: ${e.message.substring(0, 60)}`);
      }
      return null;
    }
  }

  async getPancakeSwapPrice(token0, token1) {
    try {
      this.requestCount++;
      
      // Normalize addresses
      const t0 = ethers.getAddress(token0.address);
      const t1 = ethers.getAddress(token1.address);
      
      const factory = new ethers.Contract(CONFIG.factories.pancakeswap, FACTORY_V3_ABI, this.provider);
      const quoter = new ethers.Contract(CONFIG.quoter.pancakeswap, QUOTER_V2_ABI, this.provider);
      
      // Try most common fee tiers in order
      for (const fee of [500, 3000, 10000]) {
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
          continue; // Try next fee tier
        }
      }
      return null;
    } catch (e) {
      console.error(`❌ PancakeSwap error: ${e.message.substring(0, 60)}`);
      return null;
    }
  }

  async scanPair(token0, token1) {
    const [aeroResult, cakeResult] = await Promise.all([
      this.getAerodromePrice(token0, token1),
      this.getPancakeSwapPrice(token0, token1)
    ]);

    if (!aeroResult || !cakeResult) {
      return null;
    }

    const spread = Math.abs(aeroResult.price - cakeResult.price) / aeroResult.price * 100;
    const spreadBp = spread * 100;
    
    // Only return opportunity if >0.3% (profitable)
    if (spread > 0.3) {
      return {
        pair: `${token0.symbol}/${token1.symbol}`,
        aeroPrice: aeroResult.price,
        cakePrice: cakeResult.price,
        spreadPercent: spread.toFixed(4),
        spreadBp: spreadBp.toFixed(1),
        buyDex: aeroResult.price < cakeResult.price ? aeroResult.dex : cakeResult.dex,
        sellDex: aeroResult.price > cakeResult.price ? aeroResult.dex : cakeResult.dex,
        netProfit: (spread - 0.3).toFixed(4) // After gas
      };
    }
    
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

    const opportunities = [];

    for (const [token0, token1] of pairs) {
      const opp = await this.scanPair(token0, token1);
      if (opp) opportunities.push(opp);
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 150));
    }

    this.lastScanTime = Date.now() - startTime;
    return opportunities;
  }

  getStats() {
    return {
      rpcCalls: this.requestCount,
      lastScanDuration: this.lastScanTime
    };
  }
}

// ✅ CORRECTED EXPORT: Export the class directly
module.exports = ArbitrageScanner;

// Also export TOKENS if server.js needs them
module.exports.TOKENS = TOKENS;
