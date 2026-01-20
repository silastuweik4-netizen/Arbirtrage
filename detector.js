const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const CONFIG = {
  BASE_CHAIN_ID: 8453,
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  PRICE_DIFFERENCE_THRESHOLD: parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD) || 0.5, // percent
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS) || 10000,
  WEBHOOK_URL: process.env.WEBHOOK_URL || null,
  TRADE_SIZE: process.env.TRADE_SIZE || '1', // amount of token0
  MIN_LIQUIDITY_USD: parseInt(process.env.MIN_LIQUIDITY_USD) || 1000,
  SLIPPAGE_TOLERANCE_PCT: parseFloat(process.env.SLIPPAGE_TOLERANCE_PCT) || 1.0 // gate for VERIFIED
};

const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== ABIS ====================
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)'
];
const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle(address,address,uint24,uint256,uint160) external view returns (uint256)'
];
const UNISWAP_V2_ROUTER_ABI = [
  'function getAmountsOut(uint256,address[]) view returns (uint256[])'
];
const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint256,tuple(address from,address to,bool stable,address factory)[]) view returns (uint256[])'
];
const UNISWAP_V3_FACTORY_ABI = [
  'function getPool(address,address,uint24) view returns (address)'
];
const UNISWAP_V2_FACTORY_ABI = [
  'function getPair(address,address) view returns (address)'
];
const AERODROME_FACTORY_ABI = [
  'function getPool(address,address,bool) view returns (address)'
];
const UNISWAP_V2_PAIR_ABI = [
  'function getReserves() view returns (uint112,uint112,uint32)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];

// ==================== DEX ADDRESSES (Base) ====================
const DEX_ADDRESSES = {
  UNISWAP_V3_QUOTER: '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6',
  UNISWAP_V2_ROUTER: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  AERODROME_ROUTER: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  AERODROME_FACTORY: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
  UNISWAP_V3_FACTORY: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  UNISWAP_V2_FACTORY: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
};

// ==================== TOKEN PRICES (USD) ====================
const TOKEN_PRICES_USD = {
  WETH: 2500, USDC: 1, USDT: 1, DAI: 1,
  cbBTC: 43000, WBTC: 43000, LBTC: 43000,
  AERO: 0.8, DEGEN: 0.05, BRETT: 0.35, VIRTUAL: 5,
  SOL: 200, wstETH: 3200, weETH: 3200,
  USDS: 1, USDe: 1, sUSDS: 1, sUSDC: 1, sUSDe: 1,
  DOT: 8, AAVE: 320, ENA: 1, rETH: 3200,
  syrupUSDC: 1, TRUMP: 30, SolvBTC: 43000,
  LsETH: 3200, MORPHO: 2, ezETH: 3200,
  CRV: 0.3, LINK: 22, LDO: 3
};

// ==================== TOKENS (Base) ====================
// Expand this with all 60+ Base chain tokens you want scanned
const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', name: 'WETH', decimals: 18 },
  USDC: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'USDC', decimals: 6 },
  USDT: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', name: 'USDT', decimals: 6 },
  DAI: { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', name: 'DAI', decimals: 18 },
  cbBTC: { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', name: 'cbBTC', decimals: 8 },
  WBTC: { address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', name: 'WBTC', decimals: 8 },
  LBTC: { address: '0xecac9c5f704e954931349da37f60e39f515c11c1', name: 'LBTC', decimals: 8 },
  AERO: { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', name: 'AERO', decimals: 18 },
  // Add the rest of your 60+ tokens here
};

// ==================== PAIR GENERATION ====================
function generatePairs() {
  const pairs = [];
  const tokenList = Object.keys(TOKENS);
  const stablecoins = ['USDC', 'USDT', 'DAI'];

  // Pair every token against each stablecoin
  for (const tName of tokenList) {
    for (const sName of stablecoins) {
      if (tName !== sName) {
        pairs.push({
          t0: TOKENS[tName],
          t1: TOKENS[sName],
          dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome']
        });
      }
    }
  }

  // Pair every token against WETH
  for (const tName of tokenList) {
    if (tName !== 'WETH') {
      pairs.push({
        t0: TOKENS[tName],
        t1: TOKENS.WETH,
        dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome']
      });
    }
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

  async getLiquidityUSD(token0, token1, dexType) {
    try {
      if (dexType === 'uniswap_v3') {
        const feeTiers = [100, 500, 3000, 10000];
        let maxLiquidity = 0;

        for (const fee of feeTiers) {
          const pool = await this.v3Factory.getPool(token0.address, token1.address, fee);
          if (pool === ethers.constants.AddressZero) continue;

          const t0 = new ethers.Contract(token0.address, ERC20_ABI, provider);
          const t1 = new ethers.Contract(token1.address, ERC20_ABI, provider);

          const bal0 = await t0.balanceOf(pool);
          const bal1 = await t1.balanceOf(pool);

          const bal0USD = parseFloat(ethers.utils.formatUnits(bal0, token0.decimals)) * (TOKEN_PRICES_USD[token0.name] || 0);
          const bal1USD = parseFloat(ethers.utils.formatUnits(bal1, token1.decimals)) * (TOKEN_PRICES_USD[token1.name] || 0);

          const totalUSD = bal0USD + bal1USD;
          if (totalUSD > maxLiquidity) maxLiquidity = totalUSD;

          console.log(`🧪 V3 Pool ${token0.name}/${token1.name} @ fee ${(fee/10000).toFixed(2)}% | Address: ${pool} | Liquidity: $${totalUSD.toFixed(2)}`);
        }

        return maxLiquidity;
      }

      // Uniswap V2 / Aerodrome
      let poolAddress = ethers.constants.AddressZero;
      if (dexType === 'uniswap_v2') {
        poolAddress = await this.v2Factory.getPair(token0.address, token1.address);
      } else if (dexType === 'aerodrome') {
        poolAddress = await this.aeroFactory.getPool(token0.address, token1.address, false);
      }
      if (poolAddress === ethers.constants.AddressZero) return 0;

      const t0 = new ethers.Contract(token0.address, ERC20_ABI, provider);
      const t1 = new ethers.Contract(token1.address, ERC20_ABI, provider);

      const bal0 = await t0.balanceOf(poolAddress);
      const bal1 = await t1.balanceOf(poolAddress);

      const bal0USD = parseFloat(ethers.utils.formatUnits(bal0, token0.decimals)) * (TOKEN_PRICES_USD[token0.name] || 0);
      const bal1USD = parseFloat(ethers.utils.formatUnits(bal1, token1.decimals)) * (TOKEN_PRICES_USD[token1.name] || 0);

      const totalUSD = bal0USD + bal1USD;

      console.log(`🧪 ${dexType} Pool ${token0.name}/${token1.name} | Address: ${poolAddress} | Liquidity: $${totalUSD.toFixed(2)}`);

      return totalUSD;
    } catch (e) {
      console.log(`⚠️ Liquidity check failed for ${token0.name}/${token1.name} on ${dexType}: ${e.message}`);
      return 0;
    }
  }

  // Return both amountOut and best fee tier for V3; plain amountOut for V2/Aerodrome
  async getPrice(token0, token1, dexType, tradeSize) {
    const amountIn = ethers.utils.parseUnits(tradeSize, token0.decimals);
    try {
      if (dexType === 'uniswap_v3') {
        const feeTiers = [100, 500, 3000, 10000];
        let bestOut = ethers.BigNumber.from(0);
        let bestFee = null;

        for (const fee of feeTiers) {
          try {
            const out = await this.quoterV3.callStatic.quoteExactInputSingle(
              token0.address, token1.address, fee, amountIn, 0
            );
            if (out.gt(bestOut)) { bestOut = out; bestFee = fee; }
          } catch (_) {}
        }

        if (bestOut.gt(0)) {
          console.log(`💬 V3 quote ${token0.name}->${token1.name} best fee ${(bestFee/10000).toFixed(2)}% | out: ${ethers.utils.formatUnits(bestOut, token1.decimals)}`);
          return { out: bestOut, fee: bestFee };
        }
        return null;
      } else if (dexType === 'uniswap_v2') {
        const amounts = await this.routerV2.getAmountsOut(amountIn, [token0.address, token1.address]);
        return { out: amounts[1] };
      } else if (dexType === 'aerodrome') {
        const routes = [{ from: token0.address, to: token1.address, stable: false, factory: DEX_ADDRESSES.AERODROME_FACTORY }];
        const amounts = await this.aerodromeRouter.getAmountsOut(amountIn, routes);
        return { out: amounts[1] };
      }
    } catch (e) {
      console.log(`⚠️ Price quote failed for ${dexType} ${token0.name}/${token1.name}: ${e.message}`);
      return null;
    }
    return null;
  }
}

// ==================== ARBITRAGE DETECTOR ====================
class ArbitrageDetector {
  constructor() {
    this.prices = new PriceFetcher();
  }

  async estimateGasCostUSD() {
    try {
      const gasPrice = await provider.getGasPrice();
      const gasUnits = 200000; // rough per swap; adjust if batching
      const gasCostETH = parseFloat(ethers.utils.formatUnits(gasPrice.mul(gasUnits), 18));
      const gasCostUSD = gasCostETH * (TOKEN_PRICES_USD['WETH'] || 0);
      return gasCostUSD;
    } catch (_) { return 0; }
  }

  async simulateSlippageV2(pair) {
    try {
      const v2PairAddr = await this.prices.v2Factory.getPair(pair.t0.address, pair.t1.address);
      if (v2PairAddr === ethers.constants.AddressZero) return 0;
      const pairContract = new ethers.Contract(v2PairAddr, UNISWAP_V2_PAIR_ABI, provider);
      const [reserve0, reserve1] = await pairContract.getReserves();
      const token0Addr = await pairContract.token0();
      const token1Addr = await pairContract.token1();

      let reserveInBN, reserveOutBN;
      if (token0Addr.toLowerCase() === pair.t0.address.toLowerCase()) {
        reserveInBN = reserve0; reserveOutBN = reserve1;
      } else {
        reserveInBN = reserve1; reserveOutBN = reserve0;
      }

      const reserveIn = parseFloat(ethers.utils.formatUnits(reserveInBN, pair.t0.decimals));
      const reserveOut = parseFloat(ethers.utils.formatUnits(reserveOutBN, pair.t1.decimals));
      const amountIn = parseFloat(CONFIG.TRADE_SIZE);

      if (reserveIn <= 0 || reserveOut <= 0 || amountIn <= 0) return 0;

      const simulatedOut = (reserveOut * amountIn) / (reserveIn + amountIn);
      return simulatedOut; // token1 units
    } catch (_) { return 0; }
  }

  async simulateSlippageV3(token0, token1, fee) {
    try {
      const amountSmall = ethers.utils.parseUnits("0.1", token0.decimals);
      const amountLarge = ethers.utils.parseUnits("1", token0.decimals);

      const outSmall = await this.prices.quoterV3.callStatic.quoteExactInputSingle(
        token0.address, token1.address, fee, amountSmall, 0
      );
      const outLarge = await this.prices.quoterV3.callStatic.quoteExactInputSingle(
        token0.address, token1.address, fee, amountLarge, 0
      );

      const priceSmall = parseFloat(ethers.utils.formatUnits(outSmall, token1.decimals)) / 0.1;
      const priceLarge = parseFloat(ethers.utils.formatUnits(outLarge, token1.decimals)) / 1;

      const slippagePct = ((priceSmall - priceLarge) / priceSmall) * 100;
      return slippagePct;
    } catch (e) {
      console.log(`⚠️ V3 slippage simulation failed: ${e.message}`);
      return 0;
    }
  }

  async getSpreadData(pair) {
    const priceData = {};        // dex -> BigNumber out
    const v3FeeByDex = {};       // dex -> fee tier (only for v3)
    const liquidityData = {};    // dex -> USD

    // STEP 1: Liquidity check + price quotes
    for (const dex of pair.dexes) {
      const liquidityUSD = await this.prices.getLiquidityUSD(pair.t0, pair.t1, dex);
      liquidityData[dex] = liquidityUSD;
      if (liquidityUSD < CONFIG.MIN_LIQUIDITY_USD) continue;

      const quote = await this.prices.getPrice(pair.t0, pair.t1, dex, CONFIG.TRADE_SIZE);
      if (quote && quote.out && quote.out.gt(0)) {
        priceData[dex] = quote.out;
        if (dex === 'uniswap_v3' && quote.fee) v3FeeByDex[dex] = quote.fee;
      }
    }

    const dexNames = Object.keys(priceData);
    if (dexNames.length < 2) return null;

    // STEP 2: Best buy/sell
    let bestBuyDex = null, bestBuyPrice = ethers.BigNumber.from(0);
    let bestSellDex = null, bestSellPrice = ethers.constants.MaxUint256;

    for (const dex of dexNames) {
      const price = priceData[dex];
      if (price.gt(bestBuyPrice)) { bestBuyPrice = price; bestBuyDex = dex; }
      if (price.lt(bestSellPrice)) { bestSellPrice = price; bestSellDex = dex; }
    }

    const pBuy = parseFloat(ethers.utils.formatUnits(bestBuyPrice, pair.t1.decimals)); // max out
    const pSell = parseFloat(ethers.utils.formatUnits(bestSellPrice, pair.t1.decimals)); // min out
    const diff = ((pBuy - pSell) / pSell) * 100;

    // STEP 3: Gas cost integration
    const tradeSizeUSD = parseFloat(CONFIG.TRADE_SIZE) * (TOKEN_PRICES_USD[pair.t0.name] || 1);
    const gasCostUSD = await this.estimateGasCostUSD();
    const gasImpactPct = tradeSizeUSD > 0 ? (gasCostUSD / tradeSizeUSD) * 100 : 0;
    const netDiff = diff - gasImpactPct;

    // STEP 4: Slippage simulation
    let slippagePct = 0;

    // V2-style slippage for V2/Aerodrome
    try {
      const simulatedOut = await this.simulateSlippageV2(pair); // token1 units
      if (simulatedOut > 0 && pBuy > 0) {
        const v2Slippage = ((pBuy - simulatedOut) / pBuy) * 100;
        slippagePct = v2Slippage;
      }
    } catch (_) {}

    // V3 slippage via Quoter multi-size comparison using the actual best fee tier
    if (dexNames.includes('uniswap_v3')) {
      const feeForV3 = v3FeeByDex['uniswap_v3'] || 500;
      const v3Slippage = await this.simulateSlippageV3(pair.t0, pair.t1, feeForV3);
      console.log(`🔬 V3 slippage estimate @ ${(feeForV3/10000).toFixed(2)}%: ${v3Slippage.toFixed(2)}%`);
      slippagePct = v3Slippage;
    }

    // STEP 5: Log to Render
    console.log(
      `Spread: ${diff.toFixed(2)}% | Net after gas: ${netDiff.toFixed(2)}% | Gas: $${gasCostUSD.toFixed(2)} | Slippage: ${slippagePct.toFixed(2)}%`
    );

    return {
      diff: netDiff,
      bestBuyDex,
      bestSellDex,
      pBuy,
      pSell,
      liquidityData,
      liquidDexes: dexNames,
      gasCostUSD,
      slippagePct,
      v3FeeUsed: v3FeeByDex['uniswap_v3'] || null
    };
  }

  async scan() {
    console.log(`\n[${new Date().toISOString()}] Scanning ${VERIFIED_PAIRS.length} pairs...`);
    let opportunitiesFound = 0;

    for (const pair of VERIFIED_PAIRS) {
      const firstCheck = await this.getSpreadData(pair);
      if (!firstCheck) continue;

      // Gate by threshold and slippage tolerance before double-check
      if (firstCheck.diff < CONFIG.PRICE_DIFFERENCE_THRESHOLD) continue;
      if (firstCheck.slippagePct >= CONFIG.SLIPPAGE_TOLERANCE_PCT) {
        console.log(`🚫 Slippage ${firstCheck.slippagePct.toFixed(2)}% exceeds tolerance ${CONFIG.SLIPPAGE_TOLERANCE_PCT}% for ${pair.t0.name}/${pair.t1.name}. Skipping.`);
        continue;
      }

      console.log(`🔍 Potential opportunity: ${pair.t0.name}/${pair.t1.name} (${firstCheck.diff.toFixed(2)}%). Liquidity on: ${firstCheck.liquidDexes.join(', ')}. Double checking...`);
      await new Promise(resolve => setTimeout(resolve, 500));

      const secondCheck = await this.getSpreadData(pair);
      if (
        secondCheck &&
        secondCheck.diff >= CONFIG.PRICE_DIFFERENCE_THRESHOLD &&
        secondCheck.slippagePct < CONFIG.SLIPPAGE_TOLERANCE_PCT
      ) {
        opportunitiesFound++;
        const msg = `🎯 VERIFIED OPPORTUNITY: ${pair.t0.name}/${pair.t1.name} | Profit: ${secondCheck.diff.toFixed(2)}% | Buy on ${secondCheck.bestSellDex} ($${secondCheck.pSell.toFixed(6)}), Sell on ${secondCheck.bestBuyDex} ($${secondCheck.pBuy.toFixed(6)}) | Gas: $${secondCheck.gasCostUSD.toFixed(2)} | Slippage: ${secondCheck.slippagePct.toFixed(2)}%${secondCheck.v3FeeUsed ? ` | V3 fee: ${(secondCheck.v3FeeUsed/10000).toFixed(2)}%` : ''}`;
        console.log(msg);
        if (CONFIG.WEBHOOK_URL) axios.post(CONFIG.WEBHOOK_URL, { content: msg }).catch(() => {});
      } else {
        console.log(`❌ Opportunity dropped or below threshold/slippage for ${pair.t0.name}/${pair.t1.name}.`);
      }
    }
    console.log(`✓ Scan complete. Found ${opportunitiesFound} verified opportunities.\n`);
  }
}

// ==================== EXECUTION ====================
async function main() {
  const detector = new ArbitrageDetector();
  await detector.scan();
  setInterval(() => detector.scan(), CONFIG.CHECK_INTERVAL_MS);

  // Simple health check server for Render
  const http = require('http');
  const port = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Arbitrage Bot running: Base chain, fee-tier tracked, gas-aware, V3 slippage gated.\n');
  }).listen(port, () => console.log(`Health check server on port ${port}`));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
