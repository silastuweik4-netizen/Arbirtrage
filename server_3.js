const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const MIN_LIQUIDITY = 2000;
const MIN_PROFIT_PCT = 0.5;
const MAX_PROFIT_PCT = 15;
const SCAN_INTERVAL = 1 * 60 * 1000; // 1 minute scan

// REMOTE TOKEN LIST CONFIG
const REMOTE_TOKEN_LIST_URL = process.env.TOKEN_LIST_URL || null;

let TOKENS = [
    { symbol: "ARB", address: "0x912ce59144191c1204e64559fe8253a0e49e6548" },
    { symbol: "GMX", address: "0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a" },
    { symbol: "PENDLE", address: "0x0c880f6761f1af8d9aa9c466984b80dab9a8c9f8" },
    { symbol: "RDNT", address: "0x3082ccaa395b30b11d719a1369a3de17cd7307a7" },
    { symbol: "LINK", address: "0xf97f4df75117a78c1a5a0dbb814af92458539fb4" }
];

// State
let lastScanResults = {
    timestamp: null,
    opportunities: [],
    status: "Initializing...",
    tokenCount: TOKENS.length
};

async function updateTokenList() {
    if (!REMOTE_TOKEN_LIST_URL) return;
    try {
        const res = await axios.get(REMOTE_TOKEN_LIST_URL);
        if (Array.isArray(res.data)) {
            TOKENS = res.data;
        }
    } catch (e) {
        console.error("Token list fetch failed:", e.message);
    }
}

/**
 * Fetches raw pool data from GeckoTerminal for a specific token.
 * This provides the most direct on-chain price data available via API.
 */
async function getRawPools(tokenAddress) {
    try {
        const url = `https://api.geckoterminal.com/api/v2/networks/arbitrum/tokens/${tokenAddress}/pools`;
        const res = await axios.get(url, { timeout: 5000 });
        if (res.data && res.data.data) {
            return res.data.data.map(pool => ({
                name: pool.attributes.name,
                dex: pool.relationships.dex.data.id,
                price: parseFloat(pool.attributes.token_price_usd),
                liq: parseFloat(pool.attributes.reserve_in_usd),
                address: pool.attributes.address,
                url: `https://www.geckoterminal.com/arbitrum/pools/${pool.attributes.address}`
            }));
        }
    } catch (e) {
        return [];
    }
    return [];
}

async function runScan() {
    console.log(`[${new Date().toISOString()}] Starting Direct Pool-to-Pool Scan...`);
    lastScanResults.status = "Scanning...";
    
    await updateTokenList();
    
    const results = [];
    const promises = TOKENS.map(async (token) => {
        try {
            const pools = await getRawPools(token.address);
            
            // Filter for pools with minimum liquidity
            const validPools = pools.filter(p => p.price > 0 && p.liq > MIN_LIQUIDITY);
            
            if (validPools.length < 2) return;

            // Compare every pool against every other pool
            for (let i = 0; i < validPools.length; i++) {
                for (let j = 0; j < validPools.length; j++) {
                    if (i === j) continue;

                    const buyPool = validPools[i];
                    const sellPool = validPools[j];
                    
                    // Skip if it's the same DEX (unless it's a different pool type)
                    if (buyPool.dex === sellPool.dex && buyPool.name === sellPool.name) continue;

                    const spread = ((sellPool.price - buyPool.price) / buyPool.price) * 100;

                    if (spread >= MIN_PROFIT_PCT && spread <= MAX_PROFIT_PCT) {
                        const poolBottleneck = Math.min(buyPool.liq, sellPool.liq);
                        const optimalSize = poolBottleneck * 0.005; // 0.5% for low slippage
                        
                        results.push({
                            token: token.symbol,
                            spread: spread.toFixed(2),
                            buy: buyPool,
                            sell: sellPool,
                            optimalSize: optimalSize.toFixed(2),
                            expectedProfit: (optimalSize * (spread/100 - 0.006)).toFixed(2),
                            time: new Date().toLocaleTimeString()
                        });
                    }
                }
            }
        } catch (e) {
            // Skip token
        }
    });

    await Promise.all(promises);
    
    // Sort by profit and remove very similar duplicates
    const sortedResults = results.sort((a, b) => b.spread - a.spread);
    
    lastScanResults = {
        timestamp: new Date().toLocaleString(),
        opportunities: sortedResults,
        status: "Idle",
        tokenCount: TOKENS.length
    };
    console.log(`[${new Date().toISOString()}] Scan complete. Found ${results.length} opportunities.`);
}

runScan();
setInterval(runScan, SCAN_INTERVAL);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => {
    res.render('index', { data: lastScanResults });
});

app.get('/api/results', (req, res) => {
    res.json(lastScanResults);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
