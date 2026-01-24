const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const CONFIG = {
  BASE_CHAIN_ID: 8453,
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  PRICE_DIFFERENCE_THRESHOLD: parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD) || 0.5, // %
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS) || 15000, // Increased to 15s for more intensive scanning
  WEBHOOK_URL: process.env.WEBHOOK_URL || null,
  TRADE_SIZE: process.env.TRADE_SIZE || '1', // in token0 units
  MIN_LIQUIDITY_USD: parseInt(process.env.MIN_LIQUIDITY_USD) || 5000, // Increased threshold for quality
  TOKEN_DISCOVERY_LIMIT: parseInt(process.env.TOKEN_DISCOVERY_LIMIT) || 25, // How many top tokens to fetch
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
  AERODROME_FACTORY: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
};

// ==================== TOKEN PRICES (USD) ====================
// NOTE: For a production bot, this should be fetched from a live price oracle like Chainlink.
const TOKEN_PRICES_USD = {
  WETH: 3000, // Placeholder
  USDC: 1,
  VIRTUAL: 0.15, // Placeholder
  AERO: 0.25, // Placeholder
};

// ==================== VERIFIED TOKENS ====================
const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', name: 'WETH', decimals: 18 },
  USDC: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'USDC', decimals: 6 },
};

// ==================== TRIANGULAR ROUTES ====================
// NOTE: You can expand this with more routes as you discover more tokens.
const TRIANGULAR_ROUTES = [
  // This will be dynamically generated later, but you can add manual ones here if needed.
];

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
        const fee = meta?.feeTiers?.[0] || 3000; // Use the first fee tier found
        const out = await this.quoterV3.callStatic.quoteExactInputSingle(token0.address, token1.address, fee, amountIn, 0);
        return out;
      } else if (dexType === 'uniswap_v2') {
        const amounts = await this.routerV2.getAmountsOut(amountIn, [token0.address, token1.address]);
        return amounts[1];
      } else if (dexType === 'aerodrome') {
        const routes = [{ from: token0.address, to: token1.address, stable: meta?.stable || false, factory: DEX_ADDRESSES.AERODROME_FACTORY }];
        const amounts = await this.aerodromeRouter.getAmountsOut(amountIn, routes);
        return amounts[1];
      }
    } catch (error) {
        // It's common for a quote to fail if there's no liquidity path
        return null;
    }
    return null;
  }

  async getBestQuote(tokenIn, tokenOut, tradeSize, meta = {}) {
    // We are no longer using a fixed list of venues, but the pools we discovered.
    // This function will be called for each specific pool.
    const quote = await this.getPrice(tokenIn, tokenOut, meta.dex, tradeSize, meta);
    if (!quote) return { bestOut: 0, bestVenue: null };

    const val = parseFloat(ethers.utils.formatUnits(quote, tokenOut.decimals));
    return { bestOut: val, bestVenue: `${meta.dex}_${meta.pairAddress.slice(-6)}` };
  }
}

// ==================== UNIVERSAL POOL DISCOVERY ====================
// This class finds ALL pools for a given token by querying DEX subgraphs.
class UniversalPoolDiscovery {
    constructor() {
        // Subgraph endpoints for different DEXes on Base
        this.subgraphs = {
            uniswap_v3: "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-base",
            aerodrome: "https://api.studio.thegraph.com/query/47376/aerodrome-finance-v3/version/latest",
            // NOTE: Finding a reliable, public V2 subgraph for Base can be difficult.
            // This one may work but could be unreliable. Consider de-prioritizing V2 if it fails.
            uniswap_v2: "https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v2-base",
        };
    }

    async querySubgraph(subgraphUrl, tokenAddress) {
        const query = `
        {
          pools(
            where: {
              or: [
                { token0: "${tokenAddress.toLowerCase()}" },
                { token1: "${tokenAddress.toLowerCase()}" }
              ]
            }
            orderBy: volumeUSD
            orderDirection: desc
            first: 50
          ) {
            id
            token0 { id, symbol, decimals }
            token1 { id, symbol, decimals }
            feeTier
            liquidity
            volumeUSD
          }
        }`;

        try {
            const response = await axios.post(subgraphUrl, { query });
            if (response.data.errors) {
                console.error(`[Subgraph Error] Query failed for ${subgraphUrl}:`, response.data.errors);
                return [];
            }
            return response.data.data.pools;
        } catch (error) {
            console.error(`[Subgraph Error] Failed to query ${subgraphUrl}:`, error.message);
            return [];
        }
    }

    async findAllPoolsForToken(token) {
        console.log(`[Universal Discovery] Finding ALL pools for token: ${token.name} (${token.address})`);
        const allPools = [];

        for (const [dex, url] of Object.entries(this.subgraphs)) {
            const pools = await this.querySubgraph(url, token.address);
            for (const pool of pools) {
                // Basic liquidity filter
                const liquidityUSD = parseFloat(pool.liquidity) * 0.0001; // Very rough estimate
                if (liquidityUSD < CONFIG.MIN_LIQUIDITY_USD) continue;

                const token0 = { address: ethers.utils.getAddress(pool.token0.id), name: pool.token0.symbol, decimals: parseInt(pool.token0.decimals) };
                const token1 = { address: ethers.utils.getAddress(pool.token1.id), name: pool.token1.symbol, decimals: parseInt(pool.token1.decimals) };
                
                allPools.push({
                    dex: dex,
                    pairAddress: ethers.utils.getAddress(pool.id),
                    token0: token0,
                    token1: token1,
                    meta: (dex === 'uniswap_v3' || dex === 'aerodrome') ? { feeTiers: [parseInt(pool.feeTier)] } : {}
                });
            }
        }
        console.log(`[Universal Discovery] Found ${allPools.length} active pools for ${token.name}.`);
        return allPools;
    }
}

// ==================== TOKEN FETCHER ====================
async function getTopTokensOnBase(limit = 50) {
    console.log(`[Token Fetch] Fetching top ${limit} tokens on Base from CoinGecko...`);
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=base-chain&order=volume_desc&per_page=${limit}&page=1&sparkline=false`;
    try {
        const response = await axios.get(url);
        return response.data
            .map(coin => ({
                address: coin.platforms?.['base'], // Use optional chaining in case platform is missing
                name: coin.symbol.toUpperCase(),
                // NOTE: Most tokens are 18 decimals, but not all. This is a potential point of failure.
                // A more robust solution would fetch decimals from the token contract itself.
                decimals: 18 
            }))
            .filter(t => t.address); // Filter out tokens without a Base contract address
    } catch (error) {
        console.error("[Token Fetch Error] Could not fetch tokens from CoinGecko:", error.message);
        return [];
    }
}


// ==================== ARBITRAGE DETECTOR ====================
class ArbitrageDetector {
    constructor() { 
        this.prices = new PriceFetcher();
        this.universalDiscovery = new UniversalPoolDiscovery();
        this.allMonitoredPools = []; 
        this.monitoredTokens = new Map();
    }

    async refreshPoolList() {
        console.log("\n======================================================");
        console.log("=== STARTING FULL TOKEN AND POOL DISCOVERY ===");
        console.log("======================================================");

        // 1. Get a list of tokens to monitor
        const discoveredTokens = await getTopTokensOnBase(CONFIG.TOKEN_DISCOVERY_LIMIT);
        const baseTokens = Object.values(TOKENS);
        const allTokens = [...discoveredTokens, ...baseTokens];

        // Store tokens for easy lookup
        this.monitoredTokens = new Map(allTokens.map(t => [t.address.toLowerCase(), t]));

        // 2. For each token, find ALL of its pools
        const discoveryPromises = allTokens.map(token => this.universalDiscovery.findAllPoolsForToken(token));
        const allPoolsForAllTokens = await Promise.all(discoveryPromises);
        
        // 3. Flatten the list of lists into a single list of unique pools
        const uniquePools = new Map();
        for (const poolArray of allPoolsForAllTokens) {
            for(const pool of poolArray) {
                // Create a unique key for the pool (e.g., "uniswap_v3_0x123...")
                const key = `${pool.dex}_${pool.pairAddress}`;
                if (!uniquePools.has(key)) {
                    uniquePools.set(key, pool);
                }
            }
        }
        
        this.allMonitoredPools = Array.from(uniquePools.values());
        
        console.log(`\n[Discovery Complete] Now monitoring a total of ${this.allMonitoredPools.length} pools across ${allTokens.length} tokens.\n`);
        this.generateTriangularRoutes(allTokens);
    }

    generateTriangularRoutes(tokens) {
        // Simple generation: WETH and USDC as base assets
        const baseAssets = [TOKENS.WETH, TOKENS.USDC];
        const routes = [];
        for(const token of tokens) {
            if (baseAssets.some(b => b.address === token.address)) continue;
            for(const base of baseAssets) {
                // Find a third token to complete the triangle
                const otherBase = baseAssets.find(b => b.address !== base.address);
                routes.push({
                    label: `${token.name}-${base.name}-${otherBase.name}`,
                    legs: [
                        { tokenIn: token, tokenOut: base, meta: {} },
                        { tokenIn: base, tokenOut: otherBase, meta: {} }
                    ],
                    direct: { tokenIn: token, tokenOut: otherBase, meta: {} }
                });
            }
        }
        // This is a naive generation, but it's a start. We overwrite the old routes.
        // In a real system, you'd filter for tokens that have pools with these pairs.
        TRIANGULAR_ROUTES.length = 0; // Clear old routes
        TRIANGULAR_ROUTES.push(...routes);
        console.log(`[Route Generation] Generated ${TRIANGULAR_ROUTES.length} potential triangular routes.`);
    }

    async getSpreadData(pair) {
        const priceData = {};
        const liquidityData = {};

        // Find all pools for this specific token pair
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

    async evaluateTriangularBest(route) {
        // This is a simplified version. A full implementation would find the best pool for each leg.
        const leg1Pools = this.allMonitoredPools.filter(p => 
            (p.token0.address === route.legs[0].tokenIn.address && p.token1.address === route.legs[0].tokenOut.address)
        );
        const leg2Pools = this.allMonitoredPools.filter(p => 
            (p.token0.address === route.legs[1].tokenIn.address && p.token1.address === route.legs[1].tokenOut.address)
        );
        const directPools = this.allMonitoredPools.filter(p =>
            (p.token0.address === route.direct.tokenIn.address && p.token1.address === route.direct.tokenOut.address)
        );

        if(leg1Pools.length === 0 || leg2Pools.length === 0 || directPools.length === 0) return null;

        // For simplicity, we just take the first pool found. A real bot would find the best one.
        const leg1Quote = await this.prices.getBestQuote(leg1Pools[0].token0, leg1Pools[0].token1, CONFIG.TRADE_SIZE, leg1Pools[0]);
        const leg2Quote = await this.prices.getBestQuote(leg2Pools[0].token0, leg2Pools[0].token1, CONFIG.TRADE_SIZE, leg2Pools[0]);
        const directQuote = await this.prices.getBestQuote(directPools[0].token0, directPools[0].token1, CONFIG.TRADE_SIZE, directPools[0]);

        if (!leg1Quote.bestOut || !leg2Quote.bestOut || !directQuote.bestOut) return null;
        
        const composite = leg1Quote.bestOut * leg2Quote.bestOut;
        const diff = directQuote.bestOut > 0 ? ((composite - directQuote.bestOut) / directQuote.bestOut) * 100 : 0;

        return { composite, direct: directQuote.bestOut, diff, leg1Venue: leg1Quote.bestVenue, leg2Venue: leg2Quote.bestVenue, directVenue: directQuote.bestVenue };
    }

    async scan() {
        if (this.allMonitoredPools.length === 0) {
            console.log("[Scan] No pools to monitor. Waiting for discovery to complete...");
            return;
        }
        
        console.log(`\n[${new Date().toISOString()}] Scanning ${this.allMonitoredPools.length} pools & ${TRIANGULAR_ROUTES.length} triangular routes...`);
        let opportunitiesFound = 0;

        // Get unique pairs to scan
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
            console.log(`🔍 Potential opportunity: ${baseLabel} | Spread=${result.diff.toFixed(2)}% | Double checking...`);

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

  // 1. Discover pools on startup
  await detector.refreshPoolList();

  // 2. Run the first scan
  await detector.scan();

  // 3. Set up the interval for regular scanning
  setInterval(() => detector.scan(), CONFIG.CHECK_INTERVAL_MS);

  // 4. Set up an interval to refresh the entire token/pool list periodically (e.g., every hour)
  setInterval(() => {
    console.log("\n[Periodic Check] Refreshing full token and pool list...");
    detector.refreshPoolList();
  }, 3600000); // 1 hour

  // Simple health check server
  const http = require('http');
  const port = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Universal Arbitrage Bot is running.\n');
  }).listen(port, () => console.log(`Health check server on port ${port}`));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
