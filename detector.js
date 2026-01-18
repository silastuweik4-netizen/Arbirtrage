const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const CONFIG = {
  BASE_CHAIN_ID: 8453,
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  PRICE_DIFFERENCE_THRESHOLD: parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD) || 0.5,
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS) || 10000,
  WEBHOOK_URL: process.env.WEBHOOK_URL || null,
  TRADE_SIZE: process.env.TRADE_SIZE || '1', // Reduced to 1 for testing
  MIN_LIQUIDITY_USD: parseFloat(process.env.MIN_LIQUIDITY_USD) || 10000,
};

// ==================== PROVIDER ====================
const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== ABIS ====================
const ERC20_ABI = [
  'function decimals() public view returns (uint8)',
  'function symbol() public view returns (string)',
  'function name() public view returns (string)',
  'function balanceOf(address account) public view returns (uint256)',
];

const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

const UNISWAP_V2_ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
];

// Aerodrome uses Route struct
const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, tuple(address from, address to, bool stable, address factory)[] routes) external view returns (uint256[] memory amounts)',
  'function defaultFactory() external view returns (address)',
];

// ==================== DEX ADDRESSES (BASE MAINNET, CHECKSUMMED) ====================
const DEX_ADDRESSES = {
  // Uniswap V3
  UNISWAP_V3_QUOTER: '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6',
  
  // Uniswap V2
  UNISWAP_V2_ROUTER: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  
  // Aerodrome
  AERODROME_ROUTER: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  AERODROME_FACTORY: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
  
  // PancakeSwap V3
  PANCAKESWAP_V3_QUOTER: '0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2',
};

// ==================== TOKEN ADDRESSES (CHECKSUMMED) ====================
const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', name: 'WETH', decimals: 18 },
  USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913', name: 'USDC', decimals: 6 },
  AERO: { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', name: 'AERO', decimals: 18 },
};

// ==================== TOKEN PAIR MANAGER ====================
class TokenPairManager {
  constructor() {
    this.pairs = [];
    this.loadPairs();
  }
  
  loadPairs() {
    // Define trading pairs with multiple DEX combinations
    this.pairs = [
      { token0: TOKENS.WETH, token1: TOKENS.USDC, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome', 'pancakeswap_v3'] },
      { token0: TOKENS.WETH, token1: TOKENS.AERO, dexes: ['uniswap_v3', 'aerodrome', 'pancakeswap_v3'] },
    ];
    console.log(`✓ Loaded ${this.pairs.length} verified token pairs`);
  }
  
  getPairs() { 
    return this.pairs; 
  }
}

// ==================== LIQUIDITY VALIDATOR ====================
class LiquidityValidator {
  async validateToken(tokenAddress, tokenName) {
    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      let decimals, symbol;
      try { 
        decimals = await contract.decimals(); 
      } catch { 
        decimals = null; 
      }
      try { 
        symbol = await contract.symbol(); 
      } catch { 
        symbol = 'UNKNOWN'; 
      }
      return { valid: true, decimals, symbol };
    } catch (err) {
      console.log(`  ✗ ${tokenName} validation failed: ${err?.message?.substring(0, 60) || String(err)}`);
      return { valid: false, error: err?.message || String(err) };
    }
  }
  
  async validatePair(token0, token1) {
    const val0 = await this.validateToken(token0.address, token0.name);
    if (!val0.valid) return false;
    const val1 = await this.validateToken(token1.address, token1.name);
    if (!val1.valid) return false;
    return true;
  }
}

// ==================== PRICE FETCHER ====================
class PriceFetcher {
  constructor() {
    this.quoterV3 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_QUOTER, UNISWAP_V3_QUOTER_ABI, provider);
    this.routerV2 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_ABI, provider);
    this.aerodromeRouter = new ethers.Contract(DEX_ADDRESSES.AERODROME_ROUTER, AERODROME_ROUTER_ABI, provider);
    this.pancakeQuoterV3 = new ethers.Contract(DEX_ADDRESSES.PANCAKESWAP_V3_QUOTER, UNISWAP_V3_QUOTER_ABI, provider);
  }
  
  async getSwapUniswapV3(tokenIn, tokenOut, amountIn, feeTiers = [100, 500, 3000, 10000]) {
    for (const fee of feeTiers) {
      try {
        const result = await this.quoterV3.callStatic.quoteExactInputSingle(
          tokenIn, 
          tokenOut, 
          fee, 
          amountIn, 
          0
        );
        // Handle both array and object returns
        const amountOut = Array.isArray(result) ? result[0] : result.amountOut;
        return { amountOut, fee };
      } catch (err) {
        continue;
      }
    }
    return null;
  }
  
  async getSwapUniswapV2(tokenIn, tokenOut, amountIn) {
    try {
      const amounts = await this.routerV2.getAmountsOut(amountIn, [tokenIn, tokenOut]);
      return amounts[1];
    } catch (err) {
      return null;
    }
  }
  
  async getSwapAerodrome(tokenIn, tokenOut, amountIn) {
    try {
      // Aerodrome requires Route struct with factory address
      const routes = [{
        from: tokenIn,
        to: tokenOut,
        stable: false, // Try volatile first
        factory: DEX_ADDRESSES.AERODROME_FACTORY
      }];
      
      const amounts = await this.aerodromeRouter.getAmountsOut(amountIn, routes);
      if (amounts && amounts.length > 1) {
        return amounts[1];
      }
      
      // If volatile fails, try stable
      const stableRoutes = [{
        from: tokenIn,
        to: tokenOut,
        stable: true,
        factory: DEX_ADDRESSES.AERODROME_FACTORY
      }];
      
      const stableAmounts = await this.aerodromeRouter.getAmountsOut(amountIn, stableRoutes);
      return stableAmounts && stableAmounts.length > 1 ? stableAmounts[1] : null;
    } catch (err) {
      return null;
    }
  }
  
  async getSwapPancakeSwapV3(tokenIn, tokenOut, amountIn, feeTiers = [100, 500, 2500, 10000]) {
    for (const fee of feeTiers) {
      try {
        const result = await this.pancakeQuoterV3.callStatic.quoteExactInputSingle(
          tokenIn, 
          tokenOut, 
          fee, 
          amountIn, 
          0
        );
        const amountOut = Array.isArray(result) ? result[0] : result.amountOut;
        return { amountOut, fee };
      } catch (err) {
        continue;
      }
    }
    return null;
  }
  
  async getPrice(token0, token1, dexType, tradeSize = CONFIG.TRADE_SIZE) {
    const amountIn = ethers.utils.parseUnits(tradeSize, token0.decimals);
    
    switch(dexType) {
      case 'uniswap_v3':
        const v3Result = await this.getSwapUniswapV3(token0.address, token1.address, amountIn);
        return v3Result ? v3Result.amountOut : null;
        
      case 'uniswap_v2':
        return await this.getSwapUniswapV2(token0.address, token1.address, amountIn);
        
      case 'aerodrome':
        return await this.getSwapAerodrome(token0.address, token1.address, amountIn);
        
      case 'pancakeswap_v3':
        const pancakeResult = await this.getSwapPancakeSwapV3(token0.address, token1.address, amountIn);
        return pancakeResult ? pancakeResult.amountOut : null;
        
      default:
        return null;
    }
  }
}

// ==================== ARBITRAGE DETECTOR ====================
class ArbitrageDetector {
  constructor() {
    this.pairManager = new TokenPairManager();
    this.validator = new LiquidityValidator();
    this.prices = new PriceFetcher();
    this.opportunities = [];
  }
  
  async scan() {
    const pairs = this.pairManager.getPairs();
    console.log(`\n[${new Date().toISOString()}] Scanning ${pairs.length} pairs across multiple DEXs...`);
    
    for (const pair of pairs) {
      try {
        console.log(`\n  📊 Analyzing ${pair.token0.name}/${pair.token1.name}...`);
        
        // Validate tokens
        const isValid = await this.validator.validatePair(pair.token0, pair.token1);
        if (!isValid) { 
          console.log(`  ✗ Validation failed`); 
          continue; 
        }
        
        // Fetch prices from all configured DEXs for this pair
        const priceData = {};
        for (const dex of pair.dexes) {
          console.log(`    → Fetching price from ${dex}...`);
          const price = await this.prices.getPrice(pair.token0, pair.token1, dex, CONFIG.TRADE_SIZE);
          if (price && price.gt(0)) {
            priceData[dex] = price;
            const formattedPrice = ethers.utils.formatUnits(price, pair.token1.decimals);
            console.log(`    ✓ ${dex}: ${formattedPrice} ${pair.token1.name}`);
          } else {
            console.log(`    ✗ ${dex}: No liquidity or pool not found`);
          }
        }
        
        // Compare all DEX pairs to find arbitrage opportunities
        const dexNames = Object.keys(priceData);
        if (dexNames.length < 2) {
          console.log(`  ⚠ Not enough DEXs with liquidity for arbitrage`);
          continue;
        }
        
        // Find best buy and sell prices
        let bestBuyDex = null;
        let bestBuyPrice = ethers.BigNumber.from(0);
        let bestSellDex = null;
        let bestSellPrice = ethers.constants.MaxUint256;
        
        for (const dex of dexNames) {
          const price = priceData[dex];
          if (price.gt(bestBuyPrice)) {
            bestBuyPrice = price;
            bestBuyDex = dex;
          }
          if (price.lt(bestSellPrice)) {
            bestSellPrice = price;
            bestSellDex = dex;
          }
        }
        
        // Calculate price difference
        const diff = this.calculateDifference(bestBuyPrice, bestSellPrice, pair.token1.decimals);
        const buyPriceStr = ethers.utils.formatUnits(bestBuyPrice, pair.token1.decimals);
        const sellPriceStr = ethers.utils.formatUnits(bestSellPrice, pair.token1.decimals);
        
        if (Math.abs(diff) >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
          const opp = { 
            pair: `${pair.token0.name}/${pair.token1.name}`, 
            priceDiff: diff.toFixed(4), 
            buyDex: bestBuyDex,
            sellDex: bestSellDex,
            buyPrice: buyPriceStr, 
            sellPrice: sellPriceStr, 
            profitPercent: `${diff.toFixed(2)}%`,
            timestamp: new Date().toISOString() 
          };
          
          console.log(`\n  🎯 ARBITRAGE OPPORTUNITY FOUND!`);
          console.log(`     Pair: ${opp.pair}`);
          console.log(`     Buy on ${opp.sellDex} at ${opp.sellPrice} ${pair.token1.name}`);
          console.log(`     Sell on ${opp.buyDex} at ${opp.buyPrice} ${pair.token1.name}`);
          console.log(`     Profit: ${opp.profitPercent}`);
          
          this.opportunities.push(opp);
          
          // Send webhook notification
          if (CONFIG.WEBHOOK_URL) {
            try {
              await axios.post(CONFIG.WEBHOOK_URL, {
                content: `🎯 **ARBITRAGE OPPORTUNITY**\n` +
                         `Pair: **${opp.pair}**\n` +
                         `Buy on **${opp.sellDex}** at ${opp.sellPrice}\n` +
                         `Sell on **${opp.buyDex}** at ${opp.buyPrice}\n` +
                         `Profit: **${opp.profitPercent}**\n` +
                         `Time: ${opp.timestamp}`
              });
            } catch (webhookErr) {
              console.log(`  ⚠ Webhook notification failed: ${webhookErr.message}`);
            }
          }
        } else {
          console.log(`  ℹ ${pair.token0.name}/${pair.token1.name}: Best spread ${diff.toFixed(4)}% (${bestSellDex} → ${bestBuyDex})`);
        }
        
      } catch (err) {
        console.error(`  ✗ Error scanning pair: ${err.message}`);
      }
    }
    
    console.log(`\n✓ Scan complete. Found ${this.opportunities.length} opportunities in this cycle.`);
  }
  
  calculateDifference(priceBuy, priceSell, decimalsOut) {
    const pBuy = parseFloat(ethers.utils.formatUnits(priceBuy, decimalsOut));
    const pSell = parseFloat(ethers.utils.formatUnits(priceSell, decimalsOut));
    // Percentage difference: buying high and selling low means profit
    return ((pBuy - pSell) / pSell) * 100;
  }
}

// ==================== EXECUTION ====================
async function main() {
  console.log('='.repeat(60));
  console.log('🚀 Base Chain Multi-DEX Arbitrage Bot Starting...');
  console.log('='.repeat(60));
  console.log(`RPC URL: ${CONFIG.RPC_URL}`);
  console.log(`Price Difference Threshold: ${CONFIG.PRICE_DIFFERENCE_THRESHOLD}%`);
  console.log(`Check Interval: ${CONFIG.CHECK_INTERVAL_MS}ms`);
  console.log(`Trade Size: ${CONFIG.TRADE_SIZE} tokens`);
  console.log(`Min Liquidity: $${CONFIG.MIN_LIQUIDITY_USD}`);
  console.log('='.repeat(60));
  
  const detector = new ArbitrageDetector();
  
  // Initial scan
  await detector.scan();
  
  // Continuous scanning
  setInterval(async () => {
    try {
      await detector.scan();
    } catch (err) {
      console.error(`\n❌ Scan error: ${err.message}`);
    }
  }, CONFIG.CHECK_INTERVAL_MS);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
