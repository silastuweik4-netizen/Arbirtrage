const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();
const { executeArb } = require("./arbexecutor");

// ==================== CONFIGURATION ====================
const CONFIG = {
  BASE_CHAIN_ID: 8453,
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  PRICE_DIFFERENCE_THRESHOLD: parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD) || 0.1,
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS) || 5000,
  WEBHOOK_URL: process.env.WEBHOOK_URL || null,
  TRADE_SIZE: process.env.TRADE_SIZE || '1',
  MIN_LIQUIDITY_USD: parseInt(process.env.MIN_LIQUIDITY_USD) || 100,
  PORT: parseInt(process.env.PORT || "3000"),
  ARB_CONTRACT_ADDRESS: process.env.ARB_CONTRACT_ADDRESS || "0x68168c8A65DA9Ed1cb2B674E2039C31a40BFC336"
};

// ==================== PROVIDER ====================
const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== ABIS ====================
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)'
];
const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256)',
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
];
const UNISWAP_V3_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)'
];
const UNISWAP_V2_ROUTER_ABI = [
  'function getAmountsOut(uint,address[]) view returns (uint[])',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)'
];
const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint256,tuple(address from,address to,bool stable,address factory)[]) view returns (uint256[])',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] calldata routes, address to, uint256 deadline) external returns (uint256[] memory amounts)'
];

const UNISWAP_V3_FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const UNISWAP_V2_FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const AERODROME_FACTORY_ABI = ['function getPool(address,address,bool) view returns (address)'];

// ==================== DEX ADDRESSES ====================
const DEX_ADDRESSES = {
  UNISWAP_V3_QUOTER: '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6',
  UNISWAP_V3_ROUTER: '0x2626664c2603336E57B271c5C0b26F421741e481',
  UNISWAP_V2_ROUTER: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  AERODROME_ROUTER: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  AERODROME_FACTORY: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
  PANCAKESWAP_V3_QUOTER: '0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2',
  UNISWAP_V3_FACTORY: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  UNISWAP_V2_FACTORY: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
};

// ==================== TOKEN PRICES (for USD conversion) ====================
const TOKEN_PRICES_USD = {
  'WETH': 2500, 'USDC': 1, 'USDT': 1, 'DAI': 1, 'cbBTC': 43000, 'WBTC': 43000,
  'AERO': 0.8, 'DEGEN': 0.05, 'BRETT': 0.35, 'VIRTUAL': 5, 'SOL': 200,
  'wstETH': 3200, 'weETH': 3200, 'USDS': 1, 'USDe': 1, 'sUSDS': 1, 'sUSDC': 1,
  'sUSDe': 1, 'DOT': 8, 'AAVE': 320, 'ENA': 1, 'rETH': 3200, 'syrupUSDC': 1,
  'TRUMP': 30, 'LBTC': 43000, 'SolvBTC': 43000, 'LsETH': 3200, 'MORPHO': 2,
  'ezETH': 3200, 'CRV': 0.3, 'LINK': 22, 'LDO': 3,
};

// ==================== VERIFIED TOKENS ====================
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

// ==================== DYNAMIC PAIR GENERATION ====================
function generatePairs() {
  const pairs = [];
  const tokenList = Object.keys(TOKENS);
  const stablecoins = ['USDC', 'USDT', 'DAI'];
  const majorTokens = ['WETH', 'cbBTC', 'WBTC', 'AERO'];
  
  for (const tName of majorTokens) {
    for (const sName of stablecoins) {
      pairs.push({ t0: TOKENS[tName], t1: TOKENS[sName], dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] });
    }
  }
  
  const otherTokens = tokenList.filter(t => !majorTokens.includes(t) && !stablecoins.includes(t));
  for (const tName of otherTokens) {
    pairs.push({ t0: TOKENS[tName], t1: TOKENS.WETH, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] });
    pairs.push({ t0: TOKENS[tName], t1: TOKENS.USDC, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] });
  }
  
  return pairs;
}

const VERIFIED_PAIRS = generatePairs();

// ==================== PRICE & LIQUIDITY FETCHER ====================
class PriceFetcher {
  constructor() {
    this.quoterV3 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_QUOTER, UNISWAP_V3_QUOTER_ABI, provider);
    this.routerV2 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_ABI, provider);
    this.aerodromeRouter = new ethers.Contract(DEX_ADDRESSES.AERODROME_ROUTER, AERODROME_ROUTER_ABI, provider);
    this.v3Factory = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_FACTORY, UNISWAP_V3_FACTORY_ABI, provider);
    this.v2Factory = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V2_FACTORY, UNISWAP_V2_FACTORY_ABI, provider);
    this.aeroFactory = new ethers.Contract(DEX_ADDRESSES.AERODROME_FACTORY, AERODROME_FACTORY_ABI, provider);
  }

  async withTimeout(promise, ms = 5000) {
    let timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
    return Promise.race([promise, timeout]);
  }

  async getLiquidityUSD(token0, token1, dexType) {
    try {
      let poolAddress = ethers.constants.AddressZero;
      const addr0 = ethers.utils.getAddress(token0.address);
      const addr1 = ethers.utils.getAddress(token1.address);
      const [tA, tB] = addr0.toLowerCase() < addr1.toLowerCase() ? [addr0, addr1] : [addr1, addr0];

      if (dexType === 'uniswap_v3') {
        for (const fee of [500, 3000, 10000]) {
          poolAddress = await this.withTimeout(this.v3Factory.getPool(tA, tB, fee));
          if (poolAddress !== ethers.constants.AddressZero) break;
        }
      } else if (dexType === 'uniswap_v2') {
        poolAddress = await this.withTimeout(this.v2Factory.getPair(tA, tB));
      } else if (dexType === 'aerodrome') {
        poolAddress = await this.withTimeout(this.aeroFactory.getPool(tA, tB, false));
      }

      if (poolAddress === ethers.constants.AddressZero) return 0;

      const t0Contract = new ethers.Contract(token0.address, ERC20_ABI, provider);
      const t1Contract = new ethers.Contract(token1.address, ERC20_ABI, provider);
      const [bal0, bal1] = await Promise.all([
        this.withTimeout(t0Contract.balanceOf(poolAddress)),
        this.withTimeout(t1Contract.balanceOf(poolAddress))
      ]);
      
      const val0 = parseFloat(ethers.utils.formatUnits(bal0, token0.decimals)) * (TOKEN_PRICES_USD[token0.name] || 0);
      const val1 = parseFloat(ethers.utils.formatUnits(bal1, token1.decimals)) * (TOKEN_PRICES_USD[token1.name] || 0);
      
      return val0 + val1;
    } catch (e) { return 0; }
  }

  async getPrice(token0, token1, dexType, tradeSize) {
    const amountIn = ethers.utils.parseUnits(tradeSize, token0.decimals);
    try {
      if (dexType === 'uniswap_v3') {
        let bestOut = ethers.BigNumber.from(0);
        let bestFee = 3000;
        for (const fee of [500, 3000, 10000]) {
          try {
            // Use explicit function signature for QuoterV2 struct input
            const result = await this.withTimeout(this.quoterV3["quoteExactInputSingle((address,address,uint256,uint24,uint160))"]({
              tokenIn: token0.address,
              tokenOut: token1.address,
              amountIn: amountIn,
              fee: fee,
              sqrtPriceLimitX96: 0
            }));
            const out = result.amountOut;
            if (out.gt(bestOut)) { bestOut = out; bestFee = fee; }
          } catch (e) {
            // Fallback to simple signature if struct fails
            try {
              const out = await this.withTimeout(this.quoterV3["quoteExactInputSingle(address,address,uint24,uint256,uint160)"](token0.address, token1.address, fee, amountIn, 0));
              if (out.gt(bestOut)) { bestOut = out; bestFee = fee; }
            } catch (e2) {}
          }
        }
        return bestOut.gt(0) ? { amount: bestOut, meta: { fee: bestFee } } : null;
      } else if (dexType === 'uniswap_v2') {
        const amounts = await this.withTimeout(this.routerV2.getAmountsOut(amountIn, [token0.address, token1.address]));
        return { amount: amounts[1], meta: {} };
      } else if (dexType === 'aerodrome') {
        const routes = [{ from: token0.address, to: token1.address, stable: false, factory: DEX_ADDRESSES.AERODROME_FACTORY }];
        const amounts = await this.withTimeout(this.aerodromeRouter.getAmountsOut(amountIn, routes));
        return { amount: amounts[1], meta: {} };
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

  async getSpreadData(pair) {
    const priceData = {};
    const liquidityData = {};

    for (const dex of pair.dexes) {
      const liquidityUSD = await this.prices.getLiquidityUSD(pair.t0, pair.t1, dex);
      liquidityData[dex] = liquidityUSD;
      if (liquidityUSD < CONFIG.MIN_LIQUIDITY_USD) continue;

      const result = await this.prices.getPrice(pair.t0, pair.t1, dex, CONFIG.TRADE_SIZE);
      if (result && result.amount.gt(0)) priceData[dex] = result;
    }

    const dexNames = Object.keys(priceData);
    if (dexNames.length < 2) return null;

    let bestBuyDex = null, bestBuyPrice = ethers.BigNumber.from(0), bestBuyMeta = {};
    let bestSellDex = null, bestSellPrice = ethers.constants.MaxUint256, bestSellMeta = {};

    for (const dex of dexNames) {
      const { amount, meta } = priceData[dex];
      if (amount.gt(bestBuyPrice)) { bestBuyPrice = amount; bestBuyDex = dex; bestBuyMeta = meta; }
      if (amount.lt(bestSellPrice)) { bestSellPrice = amount; bestSellDex = dex; bestSellMeta = meta; }
    }

    const pBuy = parseFloat(ethers.utils.formatUnits(bestBuyPrice, pair.t1.decimals));
    const pSell = parseFloat(ethers.utils.formatUnits(bestSellPrice, pair.t1.decimals));
    const diff = ((pBuy - pSell) / pSell) * 100;

    return { diff, bestBuyDex, bestSellDex, pBuy, pSell, bestBuyPrice, bestSellPrice, bestBuyMeta, bestSellMeta, liquidityData, liquidDexes: dexNames };
  }

  async scan() {
    console.log(`\n[${new Date().toISOString()}] Scanning ${VERIFIED_PAIRS.length} dynamically generated pairs...`);
    let opportunitiesFound = 0;

    for (const pair of VERIFIED_PAIRS) {
      const firstCheck = await this.getSpreadData(pair);
      if (!firstCheck || firstCheck.diff < CONFIG.PRICE_DIFFERENCE_THRESHOLD) continue;

      console.log(`🔍 Potential opportunity found for ${pair.t0.name}/${pair.t1.name} (${firstCheck.diff.toFixed(2)}%). Double checking...`);
      await new Promise(resolve => setTimeout(resolve, 500));

      const secondCheck = await this.getSpreadData(pair);
      if (secondCheck && secondCheck.diff >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
        opportunitiesFound++;
        const msg = `🎯 VERIFIED OPPORTUNITY: ${pair.t0.name}/${pair.t1.name} | Profit: ${secondCheck.diff.toFixed(2)}% | Buy on ${secondCheck.bestSellDex}, Sell on ${secondCheck.bestBuyDex}`;
        console.log(msg);
        if (CONFIG.WEBHOOK_URL) axios.post(CONFIG.WEBHOOK_URL, { content: msg }).catch(() => {});
        
        await this._executeArb(pair, secondCheck);
      }
    }
    console.log(`✓ Scan complete. Found ${opportunitiesFound} verified actionable opportunities.\n`);
  }

  async _executeArb(pair, data) {
    try {
      const deadline = Math.floor(Date.now() / 1000) + 600;
      const amountIn = ethers.utils.parseUnits(CONFIG.TRADE_SIZE, pair.t0.decimals);
      
      // Encode Swap A (Buy on cheaper DEX)
      let swapDataA_Uni = "0x", swapDataA_Aero = "0x";
      if (data.bestSellDex === 'uniswap_v3') {
        const iface = new ethers.utils.Interface(UNISWAP_V3_ROUTER_ABI);
        swapDataA_Uni = iface.encodeFunctionData("exactInputSingle", [{
          tokenIn: pair.t0.address, tokenOut: pair.t1.address, fee: data.bestSellMeta.fee,
          recipient: CONFIG.ARB_CONTRACT_ADDRESS, deadline, amountIn, amountOutMinimum: 0, sqrtPriceLimitX96: 0
        }]);
      } else if (data.bestSellDex === 'uniswap_v2') {
        const iface = new ethers.utils.Interface(UNISWAP_V2_ROUTER_ABI);
        swapDataA_Uni = iface.encodeFunctionData("swapExactTokensForTokens", [amountIn, 0, [pair.t0.address, pair.t1.address], CONFIG.ARB_CONTRACT_ADDRESS, deadline]);
      } else if (data.bestSellDex === 'aerodrome') {
        const iface = new ethers.utils.Interface(AERODROME_ROUTER_ABI);
        swapDataA_Aero = iface.encodeFunctionData("swapExactTokensForTokens", [amountIn, 0, [{ from: pair.t0.address, to: pair.t1.address, stable: false, factory: DEX_ADDRESSES.AERODROME_FACTORY }], CONFIG.ARB_CONTRACT_ADDRESS, deadline]);
      }

      // Encode Swap B (Sell on more expensive DEX)
      let swapDataB_Uni = "0x", swapDataB_Aero = "0x";
      if (data.bestBuyDex === 'uniswap_v3') {
        const iface = new ethers.utils.Interface(UNISWAP_V3_ROUTER_ABI);
        swapDataB_Uni = iface.encodeFunctionData("exactInputSingle", [{
          tokenIn: pair.t1.address, tokenOut: pair.t0.address, fee: data.bestBuyMeta.fee,
          recipient: CONFIG.ARB_CONTRACT_ADDRESS, deadline, amountIn: data.bestBuyPrice, amountOutMinimum: 0, sqrtPriceLimitX96: 0
        }]);
      } else if (data.bestBuyDex === 'uniswap_v2') {
        const iface = new ethers.utils.Interface(UNISWAP_V2_ROUTER_ABI);
        swapDataB_Uni = iface.encodeFunctionData("swapExactTokensForTokens", [data.bestBuyPrice, 0, [pair.t1.address, pair.t0.address], CONFIG.ARB_CONTRACT_ADDRESS, deadline]);
      } else if (data.bestBuyDex === 'aerodrome') {
        const iface = new ethers.utils.Interface(AERODROME_ROUTER_ABI);
        swapDataB_Aero = iface.encodeFunctionData("swapExactTokensForTokens", [data.bestBuyPrice, 0, [{ from: pair.t1.address, to: pair.t0.address, stable: false, factory: DEX_ADDRESSES.AERODROME_FACTORY }], CONFIG.ARB_CONTRACT_ADDRESS, deadline]);
      }

      await executeArb({
        tokenBorrow: pair.t0.address,
        amountBorrow: amountIn,
        tokenIn: pair.t0.address,
        tokenOut: pair.t1.address,
        minAmountOut: amountIn,
        swapDataA_Uni, swapDataA_Aero, swapDataB_Uni, swapDataB_Aero
      });
    } catch (err) { console.error(`Execution error: ${err.message}`); }
  }
}

async function main() {
  const detector = new ArbitrageDetector();
  await detector.scan();
  setInterval(() => detector.scan(), CONFIG.CHECK_INTERVAL_MS);
  require('http').createServer((req, res) => {
    res.writeHead(200);
    res.end('Arbitrage Bot is running with Robust Uniswap V3 Support!\n');
  }).listen(CONFIG.PORT, () => console.log(`Health check server running on port ${CONFIG.PORT}`));
}

if (require.main === module) {
  main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
}

module.exports = { ArbitrageDetector };
