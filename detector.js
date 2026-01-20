const { ethers } = require('ethers');
const axios = require('axios');
const http = require('http');
require('dotenv').config();

// ==================== HEALTH CHECK SERVER (START IMMEDIATELY) ====================
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Arbitrage Bot is running!\n');
}).listen(port, () => console.log(`[SYSTEM] Health check server active on port ${port}`));

// ==================== CONFIGURATION ====================
const CONFIG = {
  BASE_CHAIN_ID: 8453,
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  PRICE_DIFFERENCE_THRESHOLD: parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD) || 0.5,
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS) || 10000,
  WEBHOOK_URL: process.env.WEBHOOK_URL || null,
  TRADE_SIZE: process.env.TRADE_SIZE || '1',
  MIN_LIQUIDITY_USD: parseInt(process.env.MIN_LIQUIDITY_USD) || 1000,
  CONCURRENCY_LIMIT: 5,
  GAS_PRICE_GWEI: '0.1', 
  ESTIMATED_GAS_USAGE: 300000,
};

// ==================== PROVIDER ====================
const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== ABIS ====================
const ERC20_ABI = ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'];
const UNISWAP_V3_QUOTER_ABI = ['function quoteExactInputSingle(address,address,uint24,uint256,uint160) external view returns (uint256)'];
const UNISWAP_V2_ROUTER_ABI = ['function getAmountsOut(uint,address[]) view returns (uint[])'];
const UNISWAP_V2_FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const UNISWAP_V3_FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const AERODROME_ROUTER_ABI = ['function getAmountsOut(uint256,tuple(address from,address to,bool stable,address factory)[]) view returns (uint256[])'];
const AERODROME_FACTORY_ABI = ['function getPool(address,address,bool) view returns (address)'];

// ==================== DEX ADDRESSES ====================
const DEX_ADDRESSES = {
  UNISWAP_V3_QUOTER: '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6',
  UNISWAP_V2_ROUTER: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  UNISWAP_V2_FACTORY: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
  UNISWAP_V3_FACTORY: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  AERODROME_ROUTER: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  AERODROME_FACTORY: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
  SQUADSWAP_ROUTER: '0xf48d22968e87c52743F9052d8E608eCd41fAcAcC',
  SQUADSWAP_V3_FACTORY: '0xa1288b64F2378276d0Cc56F08397F70BecF7c0EA',
  SQUADSWAP_V2_FACTORY: '0xba34aA640b8Be02A439221BCbea1f48c1035EEF9',
  COW_API_URL: 'https://api.cow.fi/base/api/v1',
};

// ==================== TOKEN PRICES (for USD conversion) ====================
const TOKEN_PRICES_USD = {
  'WETH': 2500,
  'USDC': 1,
  'USDT': 1,
  'DAI': 1,
  'cbBTC': 43000,
  'WBTC': 43000,
  'AERO': 0.8,
  'DEGEN': 0.05,
  'BRETT': 0.35,
  'VIRTUAL': 5,
  'SOL': 200,
  'wstETH': 3200,
  'weETH': 3200,
  'USDS': 1,
  'USDe': 1,
  'sUSDS': 1,
  'sUSDC': 1,
  'sUSDe': 1,
  'DOT': 8,
  'AAVE': 320,
  'ENA': 1,
  'rETH': 3200,
  'syrupUSDC': 1,
  'TRUMP': 30,
  'LBTC': 43000,
  'SolvBTC': 43000,
  'LsETH': 3200,
  'MORPHO': 2,
  'ezETH': 3200,
  'CRV': 0.3,
  'LINK': 22,
  'LDO': 3,
};

// ==================== VERIFIED TOKENS ====================
const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', name: 'WETH', decimals: 18, isMajor: true },
  USDC: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'USDC', decimals: 6, isStable: true },
  USDT: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', name: 'USDT', decimals: 6, isStable: true },
  DAI: { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', name: 'DAI', decimals: 18, isStable: true },
  cbBTC: { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', name: 'cbBTC', decimals: 8, isMajor: true },
  WBTC: { address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', name: 'WBTC', decimals: 8, isMajor: true },
  AERO: { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', name: 'AERO', decimals: 18, isMajor: true },
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

// ==================== DYNAMIC PAIR GENERATION ====================
function generatePairs() {
  const pairs = [];
  const tokenList = Object.keys(TOKENS);
  const stablecoins = tokenList.filter(t => TOKENS[t].isStable);
  const majorTokens = tokenList.filter(t => TOKENS[t].isMajor);
  
  for (const tName of majorTokens) {
    for (const sName of stablecoins) {
      pairs.push({ t0: TOKENS[tName], t1: TOKENS[sName], dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome', 'squadswap', 'cowswap'] });
    }
  }
  
  const otherTokens = tokenList.filter(t => !TOKENS[t].isMajor && !TOKENS[t].isStable);
  for (const tName of otherTokens) {
    pairs.push({ t0: TOKENS[tName], t1: TOKENS.WETH, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome', 'squadswap', 'cowswap'] });
    pairs.push({ t0: TOKENS[tName], t1: TOKENS.USDC, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome', 'squadswap', 'cowswap'] });
  }
  
  return pairs;
}

const VERIFIED_PAIRS = generatePairs();

// ==================== PRICE FETCHER ====================
class PriceFetcher {
  constructor() {
    this.quoterV3 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_QUOTER, UNISWAP_V3_QUOTER_ABI, provider);
    this.routerV2 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_ABI, provider);
    this.factoryV2 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V2_FACTORY, UNISWAP_V2_FACTORY_ABI, provider);
    this.factoryV3 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_FACTORY, UNISWAP_V3_FACTORY_ABI, provider);
    this.aerodromeRouter = new ethers.Contract(DEX_ADDRESSES.AERODROME_ROUTER, AERODROME_ROUTER_ABI, provider);
    this.aerodromeFactory = new ethers.Contract(DEX_ADDRESSES.AERODROME_FACTORY, AERODROME_FACTORY_ABI, provider);
    this.squadRouterV2 = new ethers.Contract(DEX_ADDRESSES.SQUADSWAP_ROUTER, UNISWAP_V2_ROUTER_ABI, provider);
    this.squadFactoryV3 = new ethers.Contract(DEX_ADDRESSES.SQUADSWAP_V3_FACTORY, UNISWAP_V3_FACTORY_ABI, provider);
    this.squadFactoryV2 = new ethers.Contract(DEX_ADDRESSES.SQUADSWAP_V2_FACTORY, UNISWAP_V2_FACTORY_ABI, provider);
    this.ethPrice = 2500;
  }

  async updateEthPrice() {
    try {
      const amountIn = ethers.utils.parseUnits('1', 18);
      const amountOut = await this.routerV2.getAmountsOut(amountIn, [TOKENS.WETH.address, TOKENS.USDC.address]);
      this.ethPrice = parseFloat(ethers.utils.formatUnits(amountOut[1], 6));
    } catch (e) {}
  }

  async getLiquidityUSD(token0, token1, dexType) {
    try {
      let poolAddress = ethers.constants.AddressZero;
      
      if (dexType === 'uniswap_v3') {
        poolAddress = await this.factoryV3.getPool(token0.address, token1.address, 500);
      } else if (dexType === 'uniswap_v2') {
        poolAddress = await this.factoryV2.getPair(token0.address, token1.address);
      } else if (dexType === 'aerodrome') {
        poolAddress = await this.aerodromeFactory.getPool(token0.address, token1.address, false);
      } else if (dexType === 'squadswap') {
        const feeTiers = [100, 500, 3000, 10000];
        for (const fee of feeTiers) {
          try {
            poolAddress = await this.squadFactoryV3.getPool(token0.address, token1.address, fee);
            if (poolAddress !== ethers.constants.AddressZero) break;
          } catch (e) {
            continue;
          }
        }
        if (poolAddress === ethers.constants.AddressZero) {
          poolAddress = await this.squadFactoryV2.getPair(token0.address, token1.address);
        }
      } else if (dexType === 'cowswap') {
        return CONFIG.MIN_LIQUIDITY_USD + 1;
      }

      if (poolAddress === ethers.constants.AddressZero) return 0;

      const t0Contract = new ethers.Contract(token0.address, ERC20_ABI, provider);
      const bal0 = await t0Contract.balanceOf(poolAddress);

      if (bal0.isZero()) return 0;

      const balanceFormatted = parseFloat(ethers.utils.formatUnits(bal0, token0.decimals));
      const price = TOKEN_PRICES_USD[token0.name] || 1;
      const liquidityUSD = balanceFormatted * price;

      return liquidityUSD;
    } catch (e) { 
      return 0; 
    }
  }

  async getPrice(token0, token1, dexType, tradeSize) {
    const amountIn = ethers.utils.parseUnits(tradeSize, token0.decimals);
    try {
      if (dexType === 'uniswap_v3') {
        return await this.quoterV3.callStatic.quoteExactInputSingle(token0.address, token1.address, 500, amountIn, 0);
      } else if (dexType === 'uniswap_v2') {
        const amounts = await this.routerV2.getAmountsOut(amountIn, [token0.address, token1.address]);
        return amounts[1];
      } else if (dexType === 'aerodrome') {
        const routes = [{ from: token0.address, to: token1.address, stable: false, factory: DEX_ADDRESSES.AERODROME_FACTORY }];
        const amounts = await this.aerodromeRouter.getAmountsOut(amountIn, routes);
        return amounts[1];
      } else if (dexType === 'squadswap') {
        const feeTiers = [100, 500, 3000, 10000];
        for (const fee of feeTiers) {
          try {
            const result = await this.squadRouterV2.callStatic.getAmountsOut(amountIn, [token0.address, token1.address]);
            return result[1];
          } catch (e) {
            continue;
          }
        }
        return null;
      } else if (dexType === 'cowswap') {
        const response = await axios.get(`${DEX_ADDRESSES.COW_API_URL}/quote`, {
          params: { sellToken: token0.address, buyToken: token1.address, sellAmountBeforeFee: amountIn.toString() },
          timeout: 5000
        });
        return ethers.BigNumber.from(response.data.quote.buyAmount);
      }
    } catch (e) { return null; }
    return null;
  }
}

// ==================== ARBITRAGE DETECTOR ====================
class ArbitrageDetector {
  constructor() {
    this.prices = new PriceFetcher();
  }

  async processPair(pair) {
    const priceData = {};
    
    // Check liquidity first for each DEX
    for (const dex of pair.dexes) {
      const liqUSD = await this.prices.getLiquidityUSD(pair.t0, pair.t1, dex);
      if (liqUSD < CONFIG.MIN_LIQUIDITY_USD) continue;
      
      const price = await this.prices.getPrice(pair.t0, pair.t1, dex, CONFIG.TRADE_SIZE);
      if (price && price.gt(0)) priceData[dex] = price;
    }

    const dexNames = Object.keys(priceData);
    if (dexNames.length < 2) return;

    let bestBuyDex = null, bestBuyPrice = ethers.BigNumber.from(0);
    let bestSellDex = null, bestSellPrice = ethers.constants.MaxUint256;

    for (const dex of dexNames) {
      const price = priceData[dex];
      if (price.gt(bestBuyPrice)) { bestBuyPrice = price; bestBuyDex = dex; }
      if (price.lt(bestSellPrice)) { bestSellPrice = price; bestSellDex = dex; }
    }

    const pBuy = parseFloat(ethers.utils.formatUnits(bestBuyPrice, pair.t1.decimals));
    const pSell = parseFloat(ethers.utils.formatUnits(bestSellPrice, pair.t1.decimals));
    
    const dexFee = 0.003 * 2; 
    const gasCostUSD = (parseFloat(CONFIG.GAS_PRICE_GWEI) * CONFIG.ESTIMATED_GAS_USAGE) / 1e9 * this.prices.ethPrice;
    
    let gasCostInT1 = 0;
    if (pair.t1.isStable) {
      gasCostInT1 = gasCostUSD;
    } else if (pair.t1.name === 'WETH') {
      gasCostInT1 = gasCostUSD / this.prices.ethPrice;
    }

    const grossProfit = pBuy - pSell;
    const netProfit = grossProfit - (pBuy * dexFee) - gasCostInT1;
    const diff = (netProfit / pSell) * 100;

    if (diff >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
      console.log(`🔍 Potential opportunity found for ${pair.t0.name}/${pair.t1.name} (${diff.toFixed(2)}% NET). Double checking...`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const secondCheck = await this.getSpreadData(pair);
      if (secondCheck && secondCheck.diff >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
        const msg = `🎯 VERIFIED OPPORTUNITY: ${pair.t0.name}/${pair.t1.name} | Net Profit: ${secondCheck.diff.toFixed(2)}% | Buy on ${secondCheck.bestSellDex}, Sell on ${secondCheck.bestBuyDex}`;
        console.log(msg);
        if (CONFIG.WEBHOOK_URL) axios.post(CONFIG.WEBHOOK_URL, { content: msg }).catch(() => {});
      }
    }
  }

  async getSpreadData(pair) {
    const priceData = {};
    for (const dex of pair.dexes) {
      const liqUSD = await this.prices.getLiquidityUSD(pair.t0, pair.t1, dex);
      if (liqUSD < CONFIG.MIN_LIQUIDITY_USD) continue;
      
      const price = await this.prices.getPrice(pair.t0, pair.t1, dex, CONFIG.TRADE_SIZE);
      if (price && price.gt(0)) priceData[dex] = price;
    }
    
    const dexNames = Object.keys(priceData);
    if (dexNames.length < 2) return null;
    
    let bestBuyDex = null, bestBuyPrice = ethers.BigNumber.from(0);
    let bestSellDex = null, bestSellPrice = ethers.constants.MaxUint256;
    for (const dex of dexNames) {
      const price = priceData[dex];
      if (price.gt(bestBuyPrice)) { bestBuyPrice = price; bestBuyDex = dex; }
      if (price.lt(bestSellPrice)) { bestSellPrice = price; bestSellDex = dex; }
    }
    
    const pBuy = parseFloat(ethers.utils.formatUnits(bestBuyPrice, pair.t1.decimals));
    const pSell = parseFloat(ethers.utils.formatUnits(bestSellPrice, pair.t1.decimals));
    const dexFee = 0.003 * 2; 
    const gasCostUSD = (parseFloat(CONFIG.GAS_PRICE_GWEI) * CONFIG.ESTIMATED_GAS_USAGE) / 1e9 * this.prices.ethPrice;
    let gasCostInT1 = 0;
    if (pair.t1.isStable) gasCostInT1 = gasCostUSD;
    else if (pair.t1.name === 'WETH') gasCostInT1 = gasCostUSD / this.prices.ethPrice;
    const netProfit = (pBuy - pSell) - (pBuy * dexFee) - gasCostInT1;
    const diff = (netProfit / pSell) * 100;
    return { diff, bestBuyDex, bestSellDex };
  }

  async scan() {
    await this.prices.updateEthPrice();
    console.log(`\n[${new Date().toISOString()}] Starting Parallel Scan of ${VERIFIED_PAIRS.length} pairs with MIN_LIQUIDITY_USD: $${CONFIG.MIN_LIQUIDITY_USD}...`);
    
    for (let i = 0; i < VERIFIED_PAIRS.length; i += CONFIG.CONCURRENCY_LIMIT) {
      const chunk = VERIFIED_PAIRS.slice(i, i + CONFIG.CONCURRENCY_LIMIT);
      await Promise.all(chunk.map(pair => this.processPair(pair)));
    }
    
    console.log(`✓ Scan complete.`);
  }
}

// ==================== EXECUTION ====================
async function main() {
  const detector = new ArbitrageDetector();
  await detector.scan();
  setInterval(() => detector.scan(), CONFIG.CHECK_INTERVAL_MS);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
