const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const CONFIG = {
  BASE_CHAIN_ID: 8453,
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  PRICE_DIFFERENCE_THRESHOLD: parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD) || 0.5,
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS) || 15000,
  WEBHOOK_URL: process.env.WEBHOOK_URL || null,
  TRADE_SIZE: process.env.TRADE_SIZE || '1',
  MIN_LIQUIDITY_USD: parseInt(process.env.MIN_LIQUIDITY_USD) || 10000,
  POOLS_TO_FETCH_FOR_TOKENS: parseInt(process.env.POOLS_TO_FETCH_FOR_TOKENS) || 500,
};

const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== ABIS ====================
const ERC20_ABI = ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'];
const UNISWAP_V3_QUOTER_ABI = ['function quoteExactInputSingle(address,address,uint24,uint256,uint160) external view returns (uint256)'];
const UNISWAP_V2_ROUTER_ABI = ['function getAmountsOut(uint,address[]) view returns (uint[])'];
const AERODROME_ROUTER_ABI = ['function getAmountsOut(uint256,tuple(address from,address to,bool stable,address factory)[]) view returns (uint256[])'];

// ==================== DEX ADDRESSES ====================
const DEX_ADDRESSES = {
  UNISWAP_V3_QUOTER: '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6',
  UNISWAP_V2_ROUTER: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  AERODROME_ROUTER: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
};

// ==================== TRIANGULAR ROUTES ====================
let TRIANGULAR_ROUTES = [];

// ==================== PRICE & LIQUIDITY FETCHER ====================
class PriceFetcher {
  constructor() {
    this.quoterV3 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_QUOTER, UNISWAP_V3_QUOTER_ABI, provider);
    this.routerV2 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_ABI, provider);
    this.aerodromeRouter = new ethers.Contract(DEX_ADDRESSES.AERODROME_ROUTER, AERODROME_ROUTER_ABI, provider);
  }

  async getPrice(token0, token1, dexType, tradeSize, meta = {}) {
    const amountIn = ethers.utils.parseUnits(tradeSize, token0.decimals);
    try {
      if (dexType === 'uniswap_v3') {
        const fee = meta?.feeTiers?.[0] || 3000;
        const out = await this.quoterV3.callStatic.quoteExactInputSingle(token0.address, token1.address, fee, amountIn, 0);
        return out;
      } else if (dexType === 'uniswap_v2') {
        const amounts = await this.routerV2.getAmountsOut(amountIn, [token0.address, token1.address]);
        return amounts[1];
      } else if (dexType === 'aerodrome') {
        const routes = [{ from: token0.address, to: token1.address, stable: meta?.stable || false, factory: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da' }];
        const amounts = await this.aerodromeRouter.getAmountsOut(amountIn, routes);
        return amounts[1];
      }
    } catch (error) { return null; }
    return null;
  }

  async getBestQuote(tokenIn, tokenOut, tradeSize, meta = {}) {
    const quote = await this.getPrice(tokenIn, tokenOut, meta.dex, tradeSize, meta);
    if (!quote) return { bestOut: 0, bestVenue: null };
    const val = parseFloat(ethers.utils.formatUnits(quote, tokenOut.decimals));
    return { bestOut: val, bestVenue: `${meta.dex}_${meta.pairAddress.slice(-6)}` };
  }
}

// ==================== RESILIENT TWO-STAGE DISCOVERY ENGINE ====================
// This class uses a list of fallback endpoints to ensure connectivity.
class ResilientTwoStageDiscovery {
    constructor() {
        // RESILIENT: A list of fallback endpoints for each DEX
        this.subgraphEndpoints = {
            uniswap_v3: [
                "https://base-subgraph.uniswap.org/v3",
                "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-base",
                "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/0x2e8d53c8b6422b2c65a42a856e82331e538c8486dd8456c2869a8c00e26e5b3" // Replace with a real API key if needed
            ],
            aerodrome: [
                "https://graph.aerodrome.finance/subgraphs/name/aerodrome-finance/aerodrome-v3",
                "https://api.studio.thegraph.com/query/47376/aerodrome-finance-v3/version/latest",
            ],
        };
    }

    // A helper function to try each URL until one works
    async queryWithFallbacks(dex, query) {
        const endpoints = this.subgraphEndpoints[dex];
        if (!endpoints) {
            console.error(`[Fallback] No endpoints configured for ${dex}`);
            return null;
        }

        for (const url of endpoints) {
            try {
                console.log(`[Fallback] Trying ${dex} endpoint: ${url}`);
                const response = await axios.post(url, { query }, { timeout: 5000 }); // 5-second timeout
                if (response.data && response.data.data && !response.data.errors) {
                    console.log(`[Fallback] Success with ${dex} endpoint: ${url}`);
                    return response.data.data;
                }
            } catch (error) {
                console.warn(`[Fallback] Failed to connect to ${url}: ${error.message}`);
            }
        }
        console.error(`[Fallback] All endpoints failed for ${dex}.`);
        return null;
    }

    // STAGE 1: Get a master list of all tokens in top pools
    async discoverAllTokens() {
        console.log("[Stage 1] Discovering all relevant tokens from top pools...");
        const allTokens = new Map();

        for (const dex of Object.keys(this.subgraphEndpoints)) {
            const query = `
            {
                pools(first: ${CONFIG.POOLS_TO_FETCH_FOR_TOKENS}, orderBy: totalValueLockedUSD, orderDirection: desc) {
                    token0 { id, symbol, decimals }
                    token1 { id, symbol, decimals }
                }
            }`;
            const data = await this.queryWithFallbacks(dex, query);
            if (data && data.pools) {
                for (const pool of data.pools) {
                    const t0 = { address: ethers.utils.getAddress(pool.token0.id), name: pool.token0.symbol, decimals: parseInt(pool.token0.decimals) };
                    const t1 = { address: ethers.utils.getAddress(pool.token1.id), name: pool.token1.symbol, decimals: parseInt(pool.token1.decimals) };
                    allTokens.set(t0.address, t0);
                    allTokens.set(t1.address, t1);
                }
            }
        }
        console.log(`[Stage 1] Discovery complete. Found ${allTokens.size} unique tokens.\n`);
        return Array.from(allTokens.values());
    }

    // STAGE 2: For each token, find all its pools
    async findAllPoolsForTokens(tokens) {
        console.log("[Stage 2] Finding all pools for discovered tokens...");
        const allPools = [];
        const discoveryPromises = tokens.map(token => this.findPoolsForSingleToken(token));
        const poolArrays = await Promise.all(discoveryPromises);
        
        const uniquePools = new Map();
        for (const poolArray of poolArrays) {
            for (const pool of poolArray) {
                if (!uniquePools.has(pool.pairAddress)) {
                    uniquePools.set(pool.pairAddress, pool);
                }
            }
        }

        const finalPoolList = Array.from(uniquePools.values());
        console.log(`[Stage 2] Complete. Found a total of ${finalPoolList.length} pools for all tokens.\n`);
        return finalPoolList;
    }

    async findPoolsForSingleToken(token) {
        const pools = [];
        for (const dex of Object.keys(this.subgraphEndpoints)) {
            const query = `
            {
                pools(where: { or: [{ token0: "${token.address.toLowerCase()}" }, { token1: "${token.address.toLowerCase()}"] }, orderBy: totalValueLockedUSD, orderDirection: desc, first: 20) {
                    id, token0 { id, symbol, decimals }, token1 { id, symbol, decimals }, feeTier, totalValueLockedUSD
                }
            }`;
            const data = await this.queryWithFallbacks(dex, query);
            if (data && data.pools) {
                for(const pool of data.pools) {
                    if (parseFloat(pool.totalValueLockedUSD) < CONFIG.MIN_LIQUIDITY_USD) continue;
                    pools.push({
                        dex: dex,
                        pairAddress: ethers.utils.getAddress(pool.id),
                        token0: { address: ethers.utils.getAddress(pool.token0.id), name: pool.token0.symbol, decimals: parseInt(pool.token0.decimals) },
                        token1: { address: ethers.utils.getAddress(pool.token1.id), name: pool.token1.symbol, decimals: parseInt(pool.token1.decimals) },
                        meta: { feeTiers: [parseInt(pool.feeTier)], stable: false }
                    });
                }
            }
        }
        return pools;
    }
}

// ==================== ARBITRAGE DETECTOR ====================
class ArbitrageDetector {
    constructor() { 
        this.prices = new PriceFetcher();
        this.discovery = new ResilientTwoStageDiscovery(); // Use the new resilient class
        this.allMonitoredPools = []; 
    }

    async refreshPoolList() {
        const tokens = await this.discovery.discoverAllTokens();
        if (tokens.length === 0) {
            console.log("[Discovery] No tokens found. Skipping pool discovery.");
            return;
        }
        this.allMonitoredPools = await this.discovery.findAllPoolsForTokens(tokens);
        this.generateTriangularRoutes();
    }

    generateTriangularRoutes() {
        const routes = [];
        const tokenCounts = {};
        for(const pool of this.allMonitoredPools) {
            tokenCounts[pool.token0.address] = (tokenCounts[pool.token0.address] || 0) + 1;
            tokenCounts[pool.token1.address] = (tokenCounts[pool.token1.address] || 0) + 1;
        }
        const sortedTokens = Object.entries(tokenCounts).sort(([,a], [,b]) => b - a).map(([address]) => address).slice(0,3);
        if(sortedTokens.length < 3) return;

        const [tokenA, tokenB, tokenC] = sortedTokens;
        routes.push(
            { label: `${tokenA.slice(0,6)}-${tokenB.slice(0,6)}-${tokenC.slice(0,6)}`, legs: [{tokenIn: {address: tokenA}, tokenOut: {address: tokenB}}, {tokenIn: {address: tokenB}, tokenOut: {address: tokenC}}], direct: {tokenIn: {address: tokenA}, tokenOut: {address: tokenC}} },
            { label: `${tokenA.slice(0,6)}-${tokenC.slice(0,6)}-${tokenB.slice(0,6)}`, legs: [{tokenIn: {address: tokenA}, tokenOut: {address: tokenC}}, {tokenIn: {address: tokenC}, tokenOut: {address: tokenB}}], direct: {tokenIn: {address: tokenA}, tokenOut: {address: tokenB}} }
        );
        TRIANGULAR_ROUTES = routes;
        console.log(`[Route Generation] Generated ${TRIANGULAR_ROUTES.length} potential triangular routes.`);
    }

    async getSpreadData(pair) {
        const priceData = {};
        const relevantPools = this.allMonitoredPools.filter(p => 
            (p.token0.address === pair.token0.address && p.token1.address === pair.token1.address) ||
            (p.token0.address === pair.token1.address && p.token1.address === pair.token0.address)
        );
        if (relevantPools.length < 2) return null;

        for (const pool of relevantPools) {
            const quote = await this.prices.getBestQuote(pool.token0, pool.token1, CONFIG.TRADE_SIZE, pool);
            if (!quote || quote.bestOut === 0) continue;
            priceData[quote.bestVenue] = ethers.utils.parseUnits(quote.bestOut.toFixed(pool.token1.decimals), pool.token1.decimals);
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

        const pBuy = parseFloat(ethers.utils.formatUnits(bestBuyPrice, pair.token1.decimals));
        const pSell = parseFloat(ethers.utils.formatUnits(bestSellPrice, pair.token1.decimals));
        const diff = pSell > 0 ? ((pBuy - pSell) / pSell) * 100 : 0;

        return { diff, bestBuyDex, bestSellDex, pBuy, pSell, liquidDexes: dexNames };
    }

    async scan() {
        if (this.allMonitoredPools.length === 0) { console.log("[Scan] No pools to monitor..."); return; }
        
        console.log(`\n[${new Date().toISOString()}] Scanning ${this.allMonitoredPools.length} pools & ${TRIANGULAR_ROUTES.length} triangular routes...`);
        let opportunitiesFound = 0;

        const uniquePairs = new Map();
        for (const pool of this.allMonitoredPools) {
            const key = `${pool.token0.address}-${pool.token1.address}`;
            if (!uniquePairs.has(key)) {
                uniquePairs.set(key, { token0: pool.token0, token1: pool.token1 });
            }
        }

        for (const pair of uniquePairs.values()) {
            const result = await this.getSpreadData(pair);
            if (!result || result.diff < CONFIG.PRICE_DIFFERENCE_THRESHOLD) continue;

            const baseLabel = `${pair.token0.name}/${pair.token1.name}`;
            console.log(`🔍 Potential: ${baseLabel} | Spread=${result.diff.toFixed(2)}% | Double checking...`);

            await new Promise(resolve => setTimeout(resolve, 500));
            const secondCheck = await this.getSpreadData(pair);

            if (secondCheck && secondCheck.diff >= CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
                opportunitiesFound++;
                const msg = `🎯 VERIFIED: ${baseLabel} | Profit=${secondCheck.diff.toFixed(2)}% | Buy on ${secondCheck.bestSellDex} ($${secondCheck.pSell.toFixed(6)}), Sell on ${secondCheck.bestBuyDex} ($${secondCheck.pBuy.toFixed(6)})`;
                console.log(msg);
                if (CONFIG.WEBHOOK_URL) axios.post(CONFIG.WEBHOOK_URL, { content: msg }).catch(() => {});
            } else {
                console.log(`❌ Dropped: ${baseLabel} | Spread decayed.`);
            }
        }
        console.log(`✓ Scan complete. Found ${opportunitiesFound} verified opportunities.\n`);
    }
}

// ==================== EXECUTION ====================
async function main() {
  const detector = new ArbitrageDetector();
  await detector.refreshPoolList();
  await detector.scan();
  setInterval(() => detector.scan(), CONFIG.CHECK_INTERVAL_MS);
  setInterval(() => { console.log("\n[Periodic Check] Refreshing token and pool list..."); detector.refreshPoolList(); }, 3600000);

  const http = require('http');
  const port = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.statusCode = 200; res.setHeader('Content-Type', 'text/plain'); res.end('Resilient Arbitrage Bot is running.\n');
  }).listen(port, () => console.log(`Health check server on port ${port}`));
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
