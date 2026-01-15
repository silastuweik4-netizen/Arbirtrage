const { ethers } = require('ethers');

// Use environment variable for RPC, fallback to public
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

// CORRECT Addresses on Base
const AERODROME_V2_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da'; // Classic V2
const AERODROME_SLIPSTREAM_FACTORY = '0xeC8E5342B19977B4eF8892e02D8DAEcfa1315831'; // Slipstream (CL / V3)
const AERODROME_SLIPSTREAM_QUOTER = '0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0'; // Quoter for Slipstream
const PANCAKESWAP_V3_FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';
const PANCAKESWAP_V3_QUOTER = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997'; // QuoterV2 for Pancake V3

// ABIs
const FACTORY_ABI_V2 = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)'
];

const V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'
];

const V2_PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

const V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)'
];

const TOKEN_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
];

const V3_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)'
];

class ArbitrageScanner {
  constructor() {
    this.provider = null;
    this.aeroV2Factory = null;
    this.aeroSlipstreamFactory = null;
    this.aeroSlipstreamQuoter = null;
    this.pancakeFactory = null;
    this.pancakeQuoter = null;
    this.tokenCache = new Map();
    this.pairCache = new Map();
    this.requestCount = 0;
    this.maxRequestsPerScan = 500; // Increased a bit since Alchemy is reliable
  }

  async initialize() {
    this.provider = new ethers.JsonRpcProvider(BASE_RPC);

    this.aeroV2Factory = new ethers.Contract(AERODROME_V2_FACTORY, FACTORY_ABI_V2, this.provider);
    this.aeroSlipstreamFactory = new ethers.Contract(AERODROME_SLIPSTREAM_FACTORY, V3_FACTORY_ABI, this.provider);
    this.aeroSlipstreamQuoter = new ethers.Contract(AERODROME_SLIPSTREAM_QUOTER, V3_QUOTER_ABI, this.provider);
    this.pancakeFactory = new ethers.Contract(PANCAKESWAP_V3_FACTORY, V3_FACTORY_ABI, this.provider);
    this.pancakeQuoter = new ethers.Contract(PANCAKESWAP_V3_QUOTER, V3_QUOTER_ABI, this.provider);

    const block = await this.provider.getBlockNumber();
    console.log(`Connected to Base @ block ${block} via ${BASE_RPC}`);
    return true;
  }

  log(...args) { console.log(`[${new Date().toISOString()}]`, ...args); }

  async getTokenInfo(addr) {
    const lower = addr.toLowerCase();
    if (this.tokenCache.has(lower)) return this.tokenCache.get(lower);

    try {
      const c = new ethers.Contract(addr, TOKEN_ABI, this.provider);
      const [decimals, symbol] = await Promise.all([
        c.decimals().catch(() => 18),
        c.symbol().catch(() => 'UNK')
      ]);
      const info = { decimals: Number(decimals), symbol };
      this.tokenCache.set(lower, info);
      return info;
    } catch {
      return { decimals: 18, symbol: 'UNK' };
    }
  }

  // Helper: Get price of tokenB per 1 tokenA using reserves (V2)
  async _getV2Price(factory, tokenA, tokenB, dexName) {
    const key = `${dexName}-${tokenA.toLowerCase()}-${tokenB.toLowerCase()}`;
    if (this.pairCache.has(key)) return this.pairCache.get(key);

    try {
      const pairAddr = await factory.getPair(tokenA, tokenB);
      if (pairAddr === ethers.ZeroAddress) return null;

      const pair = new ethers.Contract(pairAddr, V2_PAIR_ABI, this.provider);
      const [reserves, t0] = await Promise.all([pair.getReserves(), pair.token0()]);
      const [r0, r1] = reserves;

      if (r0 === 0n || r1 === 0n) return null;

      const isAbase = t0.toLowerCase() === tokenA.toLowerCase();
      const decBase = (await this.getTokenInfo(tokenA)).decimals;
      const decQuote = (await this.getTokenInfo(tokenB)).decimals;

      let price = Number(isAbase ? r1 : r0) / Number(isAbase ? r0 : r1);
      price *= 10 ** ((isAbase ? decBase : decQuote) - (isAbase ? decQuote : decBase));

      if (!isAbase) price = 1 / price; // Ensure quote per base

      const result = { dex: dexName, pair: pairAddr, price, type: 'V2' };
      this.pairCache.set(key, result);
      this.log(`Found ${dexName} V2 pair: ${pairAddr}`);
      return result;
    } catch (e) {
      this.log(`${dexName} V2 error: ${e.message}`);
      return null;
    }
  }

  // Helper: Get effective price using Quoter for V3-style (includes fee)
  async _getV3QuotedPrice(factory, quoter, tokenIn, tokenOut, dexName) {
    const key = `${dexName}-${tokenIn.toLowerCase()}-${tokenOut.toLowerCase()}`;
    if (this.pairCache.has(key)) return this.pairCache.get(key);

    const fees = [100, 500, 2500, 10000];
    const amountIn = ethers.parseUnits('1', (await this.getTokenInfo(tokenIn)).decimals); // 1 unit input

    for (const fee of fees) {
      try {
        const poolAddr = await factory.getPool(tokenIn, tokenOut, fee);
        if (poolAddr === ethers.ZeroAddress) continue;

        // Use Quoter to get exact output
        const amountOut = await quoter.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0n);

        if (amountOut === 0n) continue;

        const decIn = (await this.getTokenInfo(tokenIn)).decimals;
        const decOut = (await this.getTokenInfo(tokenOut)).decimals;

        const price = Number(amountOut) / Number(amountIn) * 10 ** (decIn - decOut);

        const result = { dex: dexName, pool: poolAddr, fee, price, type: 'V3', quoted: true };
        this.pairCache.set(key, result);
        this.log(`Found ${dexName} V3 pool (fee ${fee}): ${poolAddr} | Quoted price: ${price.toFixed(6)}`);
        return result;
      } catch {}
    }
    return null;
  }

  async getAerodromePrice(WETH, tokenAddr) {
    // Try Slipstream first (main liquidity) with Quoter, fallback to V2 reserves
    let price = await this._getV3QuotedPrice(this.aeroSlipstreamFactory, this.aeroSlipstreamQuoter, WETH, tokenAddr, 'Aerodrome-Slipstream');
    if (!price) {
      price = await this._getV2Price(this.aeroV2Factory, WETH, tokenAddr, 'Aerodrome-V2');
    }
    return price;
  }

  async getPancakePrice(WETH, tokenAddr) {
    return this._getV3QuotedPrice(this.pancakeFactory, this.pancakeQuoter, WETH, tokenAddr, 'PancakeSwap');
  }

  async scanForArbitrageOpportunities() {
    this.requestCount = 0;
    const opps = [];

    this.log('Starting arbitrage scan...');

    const WETH = '0x4200000000000000000000000000000000000006';
    const tokens = [
      { symbol: 'USDC', addr: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
      { symbol: 'USDbC', addr: '0xd9aAEc86B65D86f6A7B630e2c953757EfB0d5e88' },
      { symbol: 'cbETH', addr: '0x2Ae3F1Ec7F1F5012CFEab0411040220A4B217aa8' },
      { symbol: 'DAI', addr: '0x50c5725949A6F0c72E6C4a641F14122319976f97' },
      { symbol: 'AERO', addr: '0x940181a94A35C424E6D2d6d8313e5E8ab37be8B0' },
      { symbol: 'ezETH', addr: '0x2416092f143378750bb29b79ed961ab195CcEea5' },
      { symbol: 'rETH', addr: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c' },
      { symbol: 'wstETH', addr: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452' },
      { symbol: 'DEGEN', addr: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed' },
      { symbol: 'TOSHI', addr: '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4' },
      { symbol: 'BRETT', addr: '0x532f27101965dd16442E59d40670FaF5eBB142E4' },
    ];

    for (const t of tokens) {
      if (this.requestCount > this.maxRequestsPerScan) break;

      this.log(`Scanning WETH/${t.symbol}...`);

      const [aero, pancake] = await Promise.all([
        this.getAerodromePrice(WETH, t.addr),
        this.getPancakePrice(WETH, t.addr)
      ]);

      let line = `  ${t.symbol}: `;
      line += aero ? `Aero ${aero.price.toFixed(6)} (${aero.type}${aero.quoted ? ' quoted' : ''})` : 'Aero ✗';
      line += ' | ';
      line += pancake ? `Pancake ${pancake.price.toFixed(6)}${pancake.quoted ? ' quoted' : ''}` : 'Pancake ✗';
      this.log(line);

      if (aero && pancake) {
        const diff = Math.abs(aero.price - pancake.price);
        const pct = (diff / Math.min(aero.price, pancake.price)) * 100;

        if (pct > 0.5) {
          const cheap = aero.price < pancake.price ? 'Aerodrome' : 'PancakeSwap';
          this.log(`  OPPORTUNITY: ${pct.toFixed(2)}% - Buy on ${cheap}`);
          opps.push({ pair: `WETH/${t.symbol}`, pct: pct.toFixed(2), cheapDex: cheap });
        }
      }
    }

    this.log(`Scan done. Found ${opps.length} opps. RPC calls: ${this.requestCount}`);
    return opps;
  }
}

module.exports = ArbitrageScanner;
