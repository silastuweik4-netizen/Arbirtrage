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
};

// ==================== PROVIDER ====================
const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== ABIS ====================
const ERC20_ABI = ['function decimals() view returns (uint8)'];
const UNISWAP_V3_QUOTER_ABI = ['function quoteExactInputSingle(address,address,uint24,uint256,uint160) external view returns (uint256)'];
const UNISWAP_V2_ROUTER_ABI = ['function getAmountsOut(uint,address[]) view returns (uint[])'];
const AERODROME_ROUTER_ABI = ['function getAmountsOut(uint256,tuple(address from,address to,bool stable,address factory)[]) view returns (uint256[])'];

// ==================== DEX ADDRESSES ====================
const DEX_ADDRESSES = {
  UNISWAP_V3_QUOTER: '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6',
  UNISWAP_V2_ROUTER: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  AERODROME_ROUTER: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  AERODROME_FACTORY: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
  PANCAKESWAP_V3_QUOTER: '0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2',
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
  wstETH: { address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452', name: 'wstETH', decimals: 18 },
  weETH: { address: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a', name: 'weETH', decimals: 18 },
  USDS: { address: '0x820c137fa70c8691f0e44dc420a5e53c168921dc', name: 'USDS', decimals: 18 },
  sUSDS: { address: '0x5875eee11cf8398102fdad704c9e96607675467a', name: 'sUSDS', decimals: 18 },
  DOT: { address: '0x8d010bf9c26881788b4e6bf5fd1bdc358c8f90b8', name: 'DOT', decimals: 18 },
  AAVE: { address: '0x63706e401c06ac8513145b7687a14804d17f814b', name: 'AAVE', decimals: 18 },
  ENA: { address: '0x58538e6A46E07434d7E7375Bc268D3cb839C0133', name: 'ENA', decimals: 18 },
  rETH: { address: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c', name: 'rETH', decimals: 18 },
  TRUMP: { address: '0xc27468b12ffa6d714b1b5fbc87ef403f38b82ad4', name: 'TRUMP', decimals: 18 },
  LsETH: { address: '0xb29749498954a3a821ec37bde86e386df3ce30b6', name: 'LsETH', decimals: 18 },
  MORPHO: { address: '0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842', name: 'MORPHO', decimals: 18 },
  ezETH: { address: '0x2416092f143378750bb29b79ed961ab195cceea5', name: 'ezETH', decimals: 18 },
  CRV: { address: '0x8Ee73c484A26e0A5df2Ee2a4960B789967dd0415', name: 'CRV', decimals: 18 },
};

// ==================== VERIFIED ACTIONABLE PAIRS ====================
// These pairs have been audited to have liquidity on at least 2 DEXs
const VERIFIED_PAIRS = [
  { t0: TOKENS.WETH, t1: TOKENS.USDC, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.WETH, t1: TOKENS.USDT, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.WETH, t1: TOKENS.DAI, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.cbBTC, t1: TOKENS.USDC, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.WBTC, t1: TOKENS.USDC, dexes: ['uniswap_v3', 'aerodrome'] },
  { t0: TOKENS.AERO, t1: TOKENS.USDC, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.DEGEN, t1: TOKENS.WETH, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.DEGEN, t1: TOKENS.USDC, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.BRETT, t1: TOKENS.WETH, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.BRETT, t1: TOKENS.USDC, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.VIRTUAL, t1: TOKENS.WETH, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.VIRTUAL, t1: TOKENS.USDC, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.wstETH, t1: TOKENS.WETH, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.wstETH, t1: TOKENS.USDC, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.weETH, t1: TOKENS.WETH, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.weETH, t1: TOKENS.USDC, dexes: ['uniswap_v3', 'aerodrome'] },
  { t0: TOKENS.USDS, t1: TOKENS.WETH, dexes: ['uniswap_v3', 'uniswap_v2'] },
  { t0: TOKENS.sUSDS, t1: TOKENS.WETH, dexes: ['uniswap_v3', 'aerodrome'] },
  { t0: TOKENS.DOT, t1: TOKENS.WETH, dexes: ['uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.AAVE, t1: TOKENS.WETH, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.ENA, t1: TOKENS.WETH, dexes: ['uniswap_v3', 'aerodrome'] },
  { t0: TOKENS.rETH, t1: TOKENS.WETH, dexes: ['uniswap_v3', 'aerodrome'] },
  { t0: TOKENS.TRUMP, t1: TOKENS.WETH, dexes: ['uniswap_v3', 'aerodrome'] },
  { t0: TOKENS.LsETH, t1: TOKENS.WETH, dexes: ['uniswap_v3', 'aerodrome'] },
  { t0: TOKENS.MORPHO, t1: TOKENS.WETH, dexes: ['uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.MORPHO, t1: TOKENS.USDC, dexes: ['uniswap_v3', 'aerodrome'] },
  { t0: TOKENS.ezETH, t1: TOKENS.WETH, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
  { t0: TOKENS.CRV, t1: TOKENS.USDC, dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome'] },
];

// ==================== PRICE FETCHER ====================
class PriceFetcher {
  constructor() {
    this.quoterV3 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_QUOTER, UNISWAP_V3_QUOTER_ABI, provider);
    this.routerV2 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_ABI, provider);
    this.aerodromeRouter = new ethers.Contract(DEX_ADDRESSES.AERODROME_ROUTER, AERODROME_ROUTER_ABI, provider);
    this.pancakeQuoterV3 = new ethers.Contract(DEX_ADDRESSES.PANCAKESWAP_V3_QUOTER, UNISWAP_V3_QUOTER_ABI, provider);
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

  async scan() {
    console.log(`\n[${new Date().toISOString()}] Scanning ${VERIFIED_PAIRS.length} verified actionable pairs...`);
    let opportunitiesFound = 0;

    for (const pair of VERIFIED_PAIRS) {
      const priceData = {};
      for (const dex of pair.dexes) {
        const price = await this.prices.getPrice(pair.t0, pair.t1, dex, CONFIG.TRADE_SIZE);
        if (price && price.gt(0)) priceData[dex] = price;
      }

      const dexNames = Object.keys(priceData);
      if (dexNames.length < 2) continue;

      let bestBuyDex = null, bestBuyPrice = ethers.BigNumber.from(0);
      let bestSellDex = null, bestSellPrice = ethers.constants.MaxUint256;

      for (const dex of dexNames) {
        const price = priceData[dex];
        if (price.gt(bestBuyPrice)) { bestBuyPrice = price; bestBuyDex = dex; }
        if (price.lt(bestSellPrice)) { bestSellPrice = price; bestSellDex = dex; }
      }

      const pBuy = parseFloat(ethers.utils.formatUnits(bestBuyPrice, pair.t1.decimals));
      const pSell = parseFloat(ethers.utils.formatUnits(bestSellPrice, pair.t1.decimals));
      const diff = ((pBuy - pSell) / pSell) * 100;

      if (diff >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
        opportunitiesFound++;
        const msg = `🎯 OPPORTUNITY: ${pair.t0.name}/${pair.t1.name} | Profit: ${diff.toFixed(2)}% | Buy on ${bestSellDex}, Sell on ${bestBuyDex}`;
        console.log(msg);
        if (CONFIG.WEBHOOK_URL) axios.post(CONFIG.WEBHOOK_URL, { content: msg }).catch(() => {});
      }
    }
    console.log(`✓ Scan complete. Found ${opportunitiesFound} actionable opportunities.`);
  }
}

// ==================== EXECUTION ====================
async function main() {
  const detector = new ArbitrageDetector();
  await detector.scan();
  setInterval(() => detector.scan(), CONFIG.CHECK_INTERVAL_MS);

  const http = require('http');
  const port = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Arbitrage Bot is running!\n');
  }).listen(port, () => console.log(`Health check server running on port ${port}`));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
