const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const CONFIG = {
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  PRICE_DIFF_THRESHOLD: 0.5, // 0.5% profit
  MIN_LIQUIDITY_USD: 5000,   // From your auditor file
  CHECK_INTERVAL_MS: 10000,
  TRADE_SIZE: '1',           // Units of Token0 (e.g., 1 WETH)
  WEBHOOK_URL: process.env.WEBHOOK_URL || null
};

const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== ABIS ====================
const ERC20_ABI = ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'];
const CHAINLINK_ABI = [{"inputs":[],"name":"latestRoundData","outputs":[{"name":"roundId","type":"uint80"},{"name":"answer","type":"int256"},{"name":"startedAt","type":"uint256"},{"name":"updatedAt","type":"uint256"},{"name":"answeredInRound","type":"uint80"}],"stateMutability":"view","type":"function"}];
const V3_QUOTER_ABI = ['function quoteExactInputSingle(address,address,uint24,uint256,uint160) external view returns (uint256)'];
const ROUTER_V2_ABI = ['function getAmountsOut(uint256,address[]) view returns (uint256[])'];
const AERO_ROUTER_ABI = ['function getAmountsOut(uint256,tuple(address from,address to,bool stable,address factory)[]) view returns (uint256[])'];
const V3_FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const V2_FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const AERO_FACTORY_ABI = ['function getPool(address,address,bool) view returns (address)'];

// ==================== ADDRESSES ====================
const ADDR = {
  V3_QUOTER: '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6',
  V3_FACTORY: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  V2_ROUTER: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  V2_FACTORY: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
  AERO_ROUTER: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  AERO_FACTORY: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da'
};

// Chainlink Feeds on Base
const ORACLES = {
  WETH: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
  BTC: '0x0fb001099e09968434778103D37286666D92634e'
};

// ==================== TOKEN LIST ====================
const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18, oracle: 'WETH' },
  USDC: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, oracle: 'STABLE' },
  cbBTC: { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', decimals: 8, oracle: 'BTC' },
  AERO: { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', decimals: 18, oracle: 'WETH' } 
};

// ==================== ENGINE ====================
class ArbDetector {
  constructor() {
    this.v3Q = new ethers.Contract(ADDR.V3_QUOTER, V3_QUOTER_ABI, provider);
    this.v3F = new ethers.Contract(ADDR.V3_FACTORY, V3_FACTORY_ABI, provider);
    this.v2R = new ethers.Contract(ADDR.V2_ROUTER, ROUTER_V2_ABI, provider);
    this.v2F = new ethers.Contract(ADDR.V2_FACTORY, V2_FACTORY_ABI, provider);
    this.aeR = new ethers.Contract(ADDR.AERO_ROUTER, AERO_ROUTER_ABI, provider);
    this.aeF = new ethers.Contract(ADDR.AERO_FACTORY, AERO_FACTORY_ABI, provider);
  }

  async getUSDPrice(token) {
    if (token.oracle === 'STABLE') return 1.0;
    try {
      const feed = new ethers.Contract(ORACLES[token.oracle], CHAINLINK_ABI, provider);
      const data = await feed.latestRoundData();
      return parseFloat(ethers.utils.formatUnits(data.answer, 8));
    } catch (e) { return 0; }
  }

  async getLiquidity(t0, t1, dex, price0) {
    try {
      let pool = ethers.constants.AddressZero;
      if (dex === 'v3') pool = await this.v3F.getPool(t0.address, t1.address, 500);
      if (dex === 'v2') pool = await this.v2F.getPair(t0.address, t1.address);
      if (dex === 'aero') pool = await this.aeF.getPool(t0.address, t1.address, false);

      if (pool === ethers.constants.AddressZero) return 0;
      const contract = new ethers.Contract(t0.address, ERC20_ABI, provider);
      const bal = await contract.balanceOf(pool);
      return parseFloat(ethers.utils.formatUnits(bal, t0.decimals)) * price0;
    } catch (e) { return 0; }
  }

  async getQuote(t0, t1, dex, amount) {
    const amtIn = ethers.utils.parseUnits(amount, t0.decimals);
    try {
      if (dex === 'v3') return await this.v3Q.callStatic.quoteExactInputSingle(t0.address, t1.address, 500, amtIn, 0);
      if (dex === 'v2') {
          const res = await this.v2R.getAmountsOut(amtIn, [t0.address, t1.address]);
          return res[1];
      }
      if (dex === 'aero') {
        const route = [{ from: t0.address, to: t1.address, stable: false, factory: ADDR.AERO_FACTORY }];
        const res = await this.aeR.getAmountsOut(amtIn, route);
        return res[1];
      }
    } catch (e) { return null; }
  }

  async scan() {
    console.log(`\n[${new Date().toLocaleTimeString()}] Scanning Base DEXes...`);
    const tKeys = Object.keys(TOKENS);

    for (let i = 0; i < tKeys.length; i++) {
      for (let j = i + 1; j < tKeys.length; j++) {
        const t0 = TOKENS[tKeys[i]];
        const t1 = TOKENS[tKeys[j]];
        const price0 = await this.getUSDPrice(t0);
        if (price0 === 0) continue;

        const dexes = ['v3', 'v2', 'aero'];
        const results = {};

        for (const dex of dexes) {
          const liq = await this.getLiquidity(t0, t1, dex, price0);
          if (liq >= CONFIG.MIN_LIQUIDITY_USD) {
            const quote = await this.getQuote(t0, t1, dex, CONFIG.TRADE_SIZE);
            if (quote) results[dex] = parseFloat(ethers.utils.formatUnits(quote, t1.decimals));
          }
        }

        const activeDexes = Object.keys(results);
        if (activeDexes.length >= 2) {
          for (let a = 0; a < activeDexes.length; a++) {
            for (let b = a + 1; b < activeDexes.length; b++) {
              const d1 = activeDexes[a];
              const d2 = activeDexes[b];
              const diff = Math.abs((results[d1] - results[d2]) / Math.max(results[d1], results[d2])) * 100;

              if (diff >= CONFIG.PRICE_DIFF_THRESHOLD) {
                const msg = `🚀 ARB: ${tKeys[i]}/${tKeys[j]} | ${diff.toFixed(2)}% | ${d1}: ${results[d1].toFixed(4)} vs ${d2}: ${results[d2].toFixed(4)}`;
                console.log(msg);
                if (CONFIG.WEBHOOK_URL) axios.post(CONFIG.WEBHOOK_URL, { content: msg }).catch(() => {});
              }
            }
          }
        }
      }
    }
  }
}

const bot = new ArbDetector();
setInterval(() => bot.scan(), CONFIG.CHECK_INTERVAL_MS);
bot.scan();
