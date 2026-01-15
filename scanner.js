const { ethers } = require('ethers');

// Use environment variable for RPC, fallback to public
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

// Addresses
const AERODROME_V2_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';
const AERODROME_SLIPSTREAM_FACTORY = '0xeC8E5342B19977B4eF8892e02D8DAEcfa1315831';
const AERODROME_SLIPSTREAM_QUOTER = '0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0';
const PANCAKESWAP_V3_FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';
const PANCAKESWAP_V3_QUOTER = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997';

// ABIs (added slot0 for fallback)
const FACTORY_ABI_V2 = ['function getPair(address tokenA, address tokenB) external view returns (address pair)'];
const V3_FACTORY_ABI = ['function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'];
const V2_PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)'
];
const V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
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
    this.maxRequestsPerScan = 500;
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
    try {
      const checksumAddr = ethers.getAddress(addr);
      const lower = checksumAddr.toLowerCase();
      if (this.tokenCache.has(lower)) return this.tokenCache.get(lower);

      const c = new ethers.Contract(checksumAddr, TOKEN_ABI, this.provider);
      const [decimals, symbol] = await Promise.all([
        c.decimals().catch(() => 18),
        c.symbol().catch(() => 'UNK')
      ]);
      const info = { decimals: Number(decimals), symbol };
      this.tokenCache.set(lower, info);
      return info;
    } catch (e) {
      this.log(`Token info failed for ${addr}: ${e.message}`);
      return { decimals: 18, symbol: 'UNK' };
    }
  }

  // Sort tokens so token0 < token1 by address
  sortTokens(tokenA, tokenB) {
    const addrA = ethers.getAddress(tokenA).toLowerCase();
    const addrB = ethers.getAddress(tokenB).toLowerCase();
    return addrA < addrB ? [tokenA, tokenB] : [tokenB, tokenA];
  }

  // V2 price (unchanged)
  async _getV2Price(factory, tokenA, tokenB, dexName) {
    const checksumA = ethers.getAddress(tokenA);
    const checksumB = ethers.getAddress(tokenB);
    const key = `${dexName}-${checksumA.toLowerCase()}-${checksumB.toLowerCase()}`;
    if (this.pairCache.has(key)) return this.pairCache.get(key);

    try {
      const pairAddr = await factory.getPair(checksumA, checksumB);
      if (pairAddr === ethers.ZeroAddress) return null;

      const pair = new ethers.Contract(pairAddr, V2_PAIR_ABI, this.provider);
      const [reserves, t0] = await Promise.all([pair.getReserves(), pair.token0()]);
      const [r0, r1] = reserves;

      if (r0 === 0n || r1 === 0n) return null;

      const isAbase = t0.toLowerCase() === checksumA.toLowerCase();
      const decBase = (await this.getTokenInfo(checksumA)).decimals;
      const decQuote = (await this.getTokenInfo(checksumB)).decimals;

      let price = Number(isAbase ? r1 : r0) / Number(isAbase ? r0 : r1);
      price *= 10 ** ((isAbase ? decBase : decQuote) - (isAbase ? decQuote : decBase));

      if (!isAbase) price = 1 / price;

      const result = { dex: dexName, pair: pairAddr, price, type: 'V2' };
      this.pairCache.set(key, result);
      this.log(`Found ${dexName} V2 pair: ${pairAddr}`);
      return result;
    } catch (e) {
      this.log(`${dexName} V2 error: ${e.message}`);
      return null;
    }
  }

  // V3 quoted price with order sorting + reverse try + slot0 fallback
  async _getV3QuotedPrice(factory, quoter, tokenBase, tokenQuote, dexName) {
    const [sortedBase, sortedQuote] = this.sortTokens(tokenBase, tokenQuote);
    const isReversed = sortedBase.toLowerCase() !== ethers.getAddress(tokenBase).toLowerCase();
    const key = `${dexName}-${tokenBase.toLowerCase()}-${tokenQuote.toLowerCase()}`;
    if (this.pairCache.has(key)) return this.pairCache.get(key);

    const fees = [100, 500, 3000, 2500, 10000]; // Added 3000
    const decBase = (await this.getTokenInfo(tokenBase)).decimals;
    const amountIn = ethers.parseUnits('1', decBase);

    let result = null;

    for (const fee of fees) {
      try {
        const poolAddr = await factory.getPool(sortedBase, sortedQuote, fee);
        if (poolAddr === ethers.ZeroAddress) continue;

        let amountOut;
        try {
          amountOut = await quoter.quoteExactInputSingle(sortedBase, sortedQuote, fee, amountIn, 0n);
        } catch (quoteErr) {
          this.log(`${dexName} quoter fee ${fee} error: ${quoteErr.message}`);
          // Fallback to slot0 price
          const pool = new ethers.Contract(poolAddr, V3_POOL_ABI, this.provider);
          const [slot0, t0] = await Promise.all([pool.slot0(), pool.token0()]);
          const sqrtPriceX96 = slot0.sqrtPriceX96;
          if (sqrtPriceX96 === 0n) continue;

          const priceRaw = (Number(sqrtPriceX96) / 2**96) ** 2;
          let price = priceRaw;
          const dec0 = (await this.getTokenInfo(t0)).decimals;
          const dec1 = (await this.getTokenInfo(t0 === sortedBase ? sortedQuote : sortedBase)).decimals;
          price *= 10 ** (dec0 - dec1);

          if (t0.toLowerCase() !== sortedBase.toLowerCase()) price = 1 / price;
          if (isReversed) price = 1 / price;

          result = { dex: dexName, pool: poolAddr, fee, price, type: 'V3', quoted: false, fallback: true };
          break;
        }

        if (amountOut === 0n) continue;

        const decQuote = (await this.getTokenInfo(tokenQuote)).decimals;
        let price = Number(amountOut) / Number(amountIn) * 10 ** (decBase - decQuote);
        if (isReversed) price = 1 / price;

        result = { dex: dexName, pool: poolAddr, fee, price, type: 'V3', quoted: true };
        this.pairCache.set(key, result);
        this.log(`Found ${dexName} V3 pool (fee ${fee}): ${poolAddr} | Quoted price: ${price.toFixed(6)}`);
        return result;
      } catch (e) {
        this.log(`${dexName} fee ${fee} error: ${e.message}`);
        continue;
      }
    }

    if (result) this.pairCache.set(key, result);
    return result;
  }

  async getAerodromePrice(WETH, tokenAddr) {
    return this._getV3QuotedPrice(this.aeroSlipstreamFactory, this.aeroSlipstreamQuoter, WETH, tokenAddr, 'Aerodrome-Slipstream') ||
           this._getV2Price(this.aeroV2Factory, WETH, tokenAddr, 'Aerodrome-V2');
  }

  async getPancakePrice(WETH, tokenAddr) {
    return this._getV3QuotedPrice(this.pancakeFactory, this.pancakeQuoter, WETH, tokenAddr, 'PancakeSwap');
  }

  async scanForArbitrageOpportunities() {
    this.requestCount = 0;
    const opps = [];

    this.log('Starting arbitrage scan...');

    const WETH = ethers.getAddress('0x4200000000000000000000000000000000000006');
    const tokens = [
      { symbol: 'USDC', addr: ethers.getAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') },
      { symbol: 'USDbC', addr: ethers.getAddress('0xd9aaec86b65d86f6a7b630e2c953757efb0d5e88') },
      { symbol: 'cbETH', addr: ethers.getAddress('0x2ae3f1ec7f1f5012cfeab0411040220a4b217aa8') },
      { symbol: 'DAI', addr: ethers.getAddress('0x50c5725949a6f0c72e6c4a641f14122319976f97') },
      { symbol: 'AERO', addr: ethers.getAddress('0x940181a94a35c424e6d2d6d8313e5e8ab37be8b0') },
      { symbol: 'ezETH', addr: ethers.getAddress('0x2416092f143378750bb29b79ed961ab195cceea5') },
      { symbol: 'rETH', addr: ethers.getAddress('0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c') },
      { symbol: 'wstETH', addr: ethers.getAddress('0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452') },
      { symbol: 'DEGEN', addr: ethers.getAddress('0x4ed4e862860bed51a9570b96d89af5e1b0efefed') },
      { symbol: 'TOSHI', addr: ethers.getAddress('0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4') },
      { symbol: 'BRETT', addr: ethers.getAddress('0x532f27101965dd16442e59d40670faf5ebb142e4') },
    ];

    for (const t of tokens) {
      if (this.requestCount > this.maxRequestsPerScan) break;

      this.log(`Scanning WETH/${t.symbol}...`);

      const [aero, pancake] = await Promise.all([
        this.getAerodromePrice(WETH, t.addr),
        this.getPancakePrice(WETH, t.addr)
      ]);

      let line = `  ${t.symbol}: `;
      line += aero ? `Aero ${aero.price.toFixed(6)} (${aero.type}${aero.quoted ? ' quoted' : ''}${aero.fallback ? ' fallback' : ''})` : 'Aero ✗';
      line += ' | ';
      line += pancake ? `Pancake ${pancake.price.toFixed(6)}${pancake.quoted ? ' quoted' : ''}${pancake.fallback ? ' fallback' : ''}` : 'Pancake ✗';
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
