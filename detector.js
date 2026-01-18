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
  TRADE_SIZE: process.env.TRADE_SIZE || '1',
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

const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, tuple(address from, address to, bool stable, address factory)[] routes) external view returns (uint256[] memory amounts)',
  'function defaultFactory() external view returns (address)',
];

// ==================== DEX ADDRESSES (BASE MAINNET) ====================
const DEX_ADDRESSES = {
  UNISWAP_V3_QUOTER: '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6',
  UNISWAP_V2_ROUTER: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  AERODROME_ROUTER: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  AERODROME_FACTORY: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
  PANCAKESWAP_V3_QUOTER: '0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2',
};

// ==================== TOKEN ADDRESSES (BASE MAINNET) ====================
const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', name: 'WETH', decimals: 18 },
  USDC: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'USDC', decimals: 6 },
  USDT: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', name: 'USDT', decimals: 6 },
  DAI: { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', name: 'DAI', decimals: 18 },
  cbBTC: { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', name: 'cbBTC', decimals: 8 },
  WBTC: { address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', name: 'WBTC', decimals: 8 },
  AERO: { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', name: 'AERO', decimals: 18 },
  DEGEN: { address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', name: 'DEGEN', decimals: 18 },
  BRETT: { address: '0x532f27101965dd16442E59d40670FaF5eBB142E4', name: 'BRETT', decimals: 18 },
  VIRTUAL: { address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', name: 'VIRTUAL', decimals: 18 },
  SOL: { address: '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82', name: 'SOL', decimals: 18 },
  wstETH: { address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452', name: 'wstETH', decimals: 18 },
  weETH: { address: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a', name: 'weETH', decimals: 18 },
  USDS: { address: '0x820c137fa70c8691f0e44dc420a5e53c168921dc', name: 'USDS', decimals: 18 },
  USDe: { address: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34', name: 'USDe', decimals: 18 },
  sUSDS: { address: '0x5875eee11cf8398102fdad704c9e96607675467a', name: 'sUSDS', decimals: 18 },
  sUSDC: { address: '0x3128a0f7f0ea68e7b7c9b00afa7e41045828e858', name: 'sUSDC', decimals: 6 },
  sUSDe: { address: '0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2', name: 'sUSDe', decimals: 18 },
  DOT: { address: '0x8d010bf9c26881788b4e6bf5fd1bdc358c8f90b8', name: 'DOT', decimals: 18 },
  AAVE: { address: '0x63706e401c06ac8513145b7687a14804d17f814b', name: 'AAVE', decimals: 18 },
  ENA: { address: '0x58538e6A46E07434d7E7375Bc268D3cb839C0133', name: 'ENA', decimals: 18 },
  rETH: { address: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c', name: 'rETH', decimals: 18 },
  syrupUSDC: { address: '0x660975730059246a68521a3e2fbd4740173100f5', name: 'syrupUSDC', decimals: 18 },
  TRUMP: { address: '0xc27468b12ffa6d714b1b5fbc87ef403f38b82ad4', name: 'TRUMP', decimals: 18 },
  LBTC: { address: '0xecac9c5f704e954931349da37f60e39f515c11c1', name: 'LBTC', decimals: 8 },
  SolvBTC: { address: '0x3b86ad95859b6ab773f55f8d94b4b9d443ee931f', name: 'SolvBTC', decimals: 18 },
  LsETH: { address: '0xb29749498954a3a821ec37bde86e386df3ce30b6', name: 'LsETH', decimals: 18 },
  MORPHO: { address: '0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842', name: 'MORPHO', decimals: 18 },
  ezETH: { address: '0x2416092f143378750bb29b79ed961ab195cceea5', name: 'ezETH', decimals: 18 },
  CRV: { address: '0x8Ee73c484A26e0A5df2Ee2a4960B789967dd0415', name: 'CRV', decimals: 18 },
  LINK: { address: '0x88Fb150BD486054367873f449caC4489Ba0E6569', name: 'LINK', decimals: 18 },
  LDO: { address: '0x76887793387768521a3e2fbd4740173100f5', name: 'LDO', decimals: 18 },
};

// ==================== TOKEN PAIR MANAGER ====================
class TokenPairManager {
  constructor() {
    this.pairs = [];
    this.loadPairs();
  }
  
  loadPairs() {
    const dexes = ['uniswap_v3', 'uniswap_v2', 'aerodrome', 'pancakeswap_v3'];
    const stablecoins = [TOKENS.USDC, TOKENS.USDT, TOKENS.DAI];
    const majorTokens = [TOKENS.WETH, TOKENS.cbBTC, TOKENS.WBTC, TOKENS.AERO];
    
    // Pair major tokens with stablecoins
    for (const token of majorTokens) {
      for (const stable of stablecoins) {
        this.pairs.push({ token0: token, token1: stable, dexes });
      }
    }
    
    // Pair other high-liquidity tokens with WETH or USDC
    const otherTokens = Object.values(TOKENS).filter(t => !majorTokens.includes(t) && !stablecoins.includes(t));
    for (const token of otherTokens) {
      this.pairs.push({ token0: token, token1: TOKENS.WETH, dexes });
      this.pairs.push({ token0: token, token1: TOKENS.USDC, dexes });
    }
    
    console.log(`✓ Loaded ${this.pairs.length} token pairs for monitoring`);
  }
  
  getPairs() { return this.pairs; }
}

// ==================== LIQUIDITY VALIDATOR ====================
class LiquidityValidator {
  async validatePair(token0, token1) {
    try {
      const contract0 = new ethers.Contract(token0.address, ERC20_ABI, provider);
      const contract1 = new ethers.Contract(token1.address, ERC20_ABI, provider);
      await Promise.all([contract0.decimals(), contract1.decimals()]);
      return true;
    } catch (err) {
      return false;
    }
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
        const result = await this.quoterV3.callStatic.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0);
        return Array.isArray(result) ? result[0] : result.amountOut;
      } catch (err) { continue; }
    }
    return null;
  }
  
  async getSwapUniswapV2(tokenIn, tokenOut, amountIn) {
    try {
      const amounts = await this.routerV2.getAmountsOut(amountIn, [tokenIn, tokenOut]);
      return amounts[1];
    } catch (err) { return null; }
  }
  
  async getSwapAerodrome(tokenIn, tokenOut, amountIn) {
    try {
      const routes = [{ from: tokenIn, to: tokenOut, stable: false, factory: DEX_ADDRESSES.AERODROME_FACTORY }];
      const amounts = await this.aerodromeRouter.getAmountsOut(amountIn, routes);
      return amounts && amounts.length > 1 ? amounts[1] : null;
    } catch (err) {
      try {
        const routes = [{ from: tokenIn, to: tokenOut, stable: true, factory: DEX_ADDRESSES.AERODROME_FACTORY }];
        const amounts = await this.aerodromeRouter.getAmountsOut(amountIn, routes);
        return amounts && amounts.length > 1 ? amounts[1] : null;
      } catch (err2) { return null; }
    }
  }
  
  async getSwapPancakeSwapV3(tokenIn, tokenOut, amountIn, feeTiers = [100, 500, 2500, 10000]) {
    for (const fee of feeTiers) {
      try {
        const result = await this.pancakeQuoterV3.callStatic.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0);
        return Array.isArray(result) ? result[0] : result.amountOut;
      } catch (err) { continue; }
    }
    return null;
  }
  
  async getPrice(token0, token1, dexType, tradeSize = CONFIG.TRADE_SIZE) {
    const amountIn = ethers.utils.parseUnits(tradeSize, token0.decimals);
    switch(dexType) {
      case 'uniswap_v3': return await this.getSwapUniswapV3(token0.address, token1.address, amountIn);
      case 'uniswap_v2': return await this.getSwapUniswapV2(token0.address, token1.address, amountIn);
      case 'aerodrome': return await this.getSwapAerodrome(token0.address, token1.address, amountIn);
      case 'pancakeswap_v3': return await this.getSwapPancakeSwapV3(token0.address, token1.address, amountIn);
      default: return null;
    }
  }
}

// ==================== ARBITRAGE DETECTOR ====================
class ArbitrageDetector {
  constructor() {
    this.pairManager = new TokenPairManager();
    this.validator = new LiquidityValidator();
    this.prices = new PriceFetcher();
  }
  
  async scan() {
    const pairs = this.pairManager.getPairs();
    console.log(`\n[${new Date().toISOString()}] Scanning ${pairs.length} pairs...`);
    
    let opportunitiesFound = 0;
    for (const pair of pairs) {
      try {
        const priceData = {};
        for (const dex of pair.dexes) {
          try {
            const price = await this.prices.getPrice(pair.token0, pair.token1, dex, CONFIG.TRADE_SIZE);
            if (price && price.gt(0)) priceData[dex] = price;
          } catch (e) {}
        }
        
        const dexNames = Object.keys(priceData);
        if (dexNames.length < 2) continue;
        
        // Log progress for every 5 pairs with liquidity
        if (Object.keys(priceData).length >= 2) {
          // console.log(`  Checked ${pair.token0.name}/${pair.token1.name} across ${dexNames.join(', ')}`);
        }
        
        let bestBuyDex = null, bestBuyPrice = ethers.BigNumber.from(0);
        let bestSellDex = null, bestSellPrice = ethers.constants.MaxUint256;
        
        for (const dex of dexNames) {
          const price = priceData[dex];
          if (price.gt(bestBuyPrice)) { bestBuyPrice = price; bestBuyDex = dex; }
          if (price.lt(bestSellPrice)) { bestSellPrice = price; bestSellDex = dex; }
        }
        
        const diff = this.calculateDifference(bestBuyPrice, bestSellPrice, pair.token1.decimals);
        if (Math.abs(diff) >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
          opportunitiesFound++;
          console.log(`🎯 OPPORTUNITY: ${pair.token0.name}/${pair.token1.name} | Profit: ${diff.toFixed(2)}% | ${bestSellDex} -> ${bestBuyDex}`);
          if (CONFIG.WEBHOOK_URL) {
            await axios.post(CONFIG.WEBHOOK_URL, {
              content: `🎯 **ARBITRAGE OPPORTUNITY**\nPair: **${pair.token0.name}/${pair.token1.name}**\nProfit: **${diff.toFixed(2)}%**\nBuy on **${bestSellDex}**, Sell on **${bestBuyDex}**`
            });
          }
        }
      } catch (err) {}
    }
    console.log(`✓ Scan complete. Found ${opportunitiesFound} opportunities.`);
  }
  
  calculateDifference(priceBuy, priceSell, decimalsOut) {
    const pBuy = parseFloat(ethers.utils.formatUnits(priceBuy, decimalsOut));
    const pSell = parseFloat(ethers.utils.formatUnits(priceSell, decimalsOut));
    return ((pBuy - pSell) / pSell) * 100;
  }
}

// ==================== EXECUTION ====================
async function main() {
  const detector = new ArbitrageDetector();
  await detector.scan();
  
  setInterval(async () => {
    try { await detector.scan(); } catch (err) {}
  }, CONFIG.CHECK_INTERVAL_MS);

  const http = require('http');
  const port = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Arbitrage Bot is running!\n');
  }).listen(port, () => {
    console.log(`Health check server running on port ${port}`);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
