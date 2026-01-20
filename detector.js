const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const CONFIG = {
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  PRICE_DIFF_THRESHOLD: 0.5,      // 0.5% profit threshold to ALERT
  MIN_REALIZABLE_PROFIT_PCT: 0.10,// 0.10% absolute minimum to EXECUTE
  SLIPIPAGE_TOLERANCE_BPS: 50,    // 0.50% (Standard 2026 protection)
  MIN_LIQUIDITY_USD: 5000,        
  CHECK_INTERVAL_MS: 10000,
  TRADE_SIZE: '1',                
  ESTIMATED_GAS_USD: 0.15,        // Avg Base DEX swap cost in Jan 2026
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
  BTC: '0x0fb001099e09968434778103D37286666D92634e',
  LINK: '0x6d573887019f20436d65451e592750343a492576'
};

// ==================== TOKEN LIST (All 23 Tokens) ====================
const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18, oracle: 'WETH' },
  USDC: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, oracle: 'STABLE' },
  USDT: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6, oracle: 'STABLE' },
  DAI: { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', decimals: 18, oracle: 'STABLE' },
  cbBTC: { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', decimals: 8, oracle: 'BTC' },
  WBTC: { address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', decimals: 8, oracle: 'BTC' },
  LBTC: { address: '0xecac9c5f704e954931349da37f60e39f515c11c1', decimals: 8, oracle: 'BTC' },
  AERO: { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', decimals: 18, oracle: 'WETH' }, // Approximated via WETH
  DEGEN: { address: '0x4e3F615BFa4970425c2C437aA75F9735aB1cE0f7', decimals: 18, oracle: 'WETH' },
  BRETT: { address: '0x532fB40497eA7C8157B5478d8a7c264c244B6c88', decimals: 18, oracle: 'WETH' },
  VIRTUAL: { address: '0xd001168f08034d673bf6e5a07c4273c52495b432', decimals: 18, oracle: 'WETH' },
  SOL: { address: '0xfd00a08e1a179e3943f9a721c56e3012879f979c', decimals: 8, oracle: 'WETH' },
  wstETH: { address: '0xfB258F5d1797585012580a5688D1C7e44F59c5c2', decimals: 18, oracle: 'WETH' },
  weETH: { address: '0x3578776632c448d3c5008581f1857c5a00a12e3f', decimals: 18, oracle: 'WETH' },
  USDS: { address: '0xe53951cb12128a3834164b3c75691456ed359d99', decimals: 18, oracle: 'STABLE' },
  USDe: { address: '0x4200000000000000000000000000000000000022', decimals: 18, oracle: 'STABLE' },
  sUSDe: { address: '0x884634f19b251a37c56c28f14890d7967201c10d', decimals: 18, oracle: 'STABLE' },
  ENA: { address: '0x535b4F4d18E6627042a9844D12A45C3373400a40', decimals: 18, oracle: 'WETH' },
  rETH: { address: '0x6e8e25d4818c64d142d765799a4c07921c327244', decimals: 18, oracle: 'WETH' },
  syrupUSDC: { address: '0xd31c195ee02b8429391ac8990d05775f0a0d9b50', decimals: 6, oracle: 'STABLE' },
  SolvBTC: { address: '0x64766099b2447990b790d9709292db2c918f0293', decimals: 18, oracle: 'BTC' },
  ezETH: { address: '0xf43a18d18105c31043c706d860e0a5c43d964f50', decimals: 18, oracle: 'WETH' },
  LINK: { address: '0x88fb15ddda235cc64831973111045ca915887919', decimals: 18, oracle: 'LINK' }
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
    if (!ORACLES[token.oracle]) return 0;
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
          return res;
      }
      if (dex === 'aero') {
        const routes = [{ from: t0.address, to: t1.address, stable: false, factory: ADDR.AERO_FACTORY }];
        const res = await this.aeR.getAmountsOut(amtIn, routes);
        return res;
      }
    } catch (e) { return null; }
  }

  async scan() {
    console.log(`\n[${new Date().toLocaleTimeString()}] Scanning ${Object.keys(TOKENS).length} Tokens across 3 DEXes...`);
    const tKeys = Object.keys(TOKENS);

    for (let i = 0; i < tKeys.length; i++) {
      for (let j = 0; j < tKeys.length; j++) {
        if (i === j) continue;
        const t0 = TOKENS[tKeys[i]];
        const t1 = TOKENS[tKeys[j]];
        const p0 = await this.getUSDPrice(t0);
        const p1 = await this.getUSDPrice(t1);
        if (p0 === 0 || p1 === 0) continue;

        const results = {};
        for (const dex of ['v3', 'v2', 'aero']) {
          const liq = await this.getLiquidity(t0, t1, dex, p0);
          if (liq >= CONFIG.MIN_LIQUIDITY_USD) {
            const quote = await this.getQuote(t0, t1, dex, CONFIG.TRADE_SIZE);
            if (quote) results[dex] = quote;
          }
        }

        const dexes = Object.keys(results);
        if (dexes.length < 2) continue;

        for (const d1 of dexes) {
          for (const d2 of dexes) {
            if (d1 === d2) continue;
            
            const q1 = parseFloat(ethers.utils.formatUnits(results[d1], t1.decimals));
            const q2 = parseFloat(ethers.utils.formatUnits(results[d2], t1.decimals));
            const diff = ((q2 - q1) / q1) * 100;

            if (diff >= CONFIG.PRICE_DIFF_THRESHOLD) {
              const q2BN = results[d2];
              const minOut = q2BN.mul(10000 - CONFIG.SLIPIPAGE_TOLERANCE_BPS).div(10000);
              const minOutFormatted = parseFloat(ethers.utils.formatUnits(minOut, t1.decimals));

              const inputUSD = parseFloat(CONFIG.TRADE_SIZE) * p0;
              const outputUSD = minOutFormatted * p1;
              const profitAfterGas = (outputUSD - inputUSD) - CONFIG.ESTIMATED_GAS_USD;
              const realizableProfitPct = (profitAfterGas / inputUSD) * 100;

              if (realizableProfitPct >= CONFIG.MIN_REALIZABLE_PROFIT_PCT) {
                const msg = `💰 EXECUTE: ${tKeys[i]}/${tKeys[j]} | Realizable: ${realizableProfitPct.toFixed(2)}% | MinOut: ${minOutFormatted.toFixed(6)} | Buy on ${d1} -> Sell on ${d2}`;
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
