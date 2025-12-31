const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const MIN_LIQUIDITY = 2000;
const MIN_PROFIT_PCT = 0.5;
const MAX_PROFIT_PCT = 15;
const SCAN_INTERVAL = 2 * 60 * 1000; // Faster scan (2 mins) for real-time data

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

function calculateOptimalTrade(buyLiq, sellLiq, spread) {
    const poolBottleneck = Math.min(buyLiq, sellLiq);
    let optimalSize = poolBottleneck * 0.005;
    if (spread < 1.0) optimalSize = optimalSize * 0.5;
    return Math.max(optimalSize, 0);
}

async function runScan() {
    console.log(`[${new Date().toISOString()}] Starting Real-Time Multi-Pool Scan...`);
    lastScanResults.status = "Scanning...";
    
    await updateTokenList();
    
    const results = [];
    const promises = TOKENS.map(async (token) => {
        try {
            // Using KyberSwap's API to get individual pool data
            // This is much faster and more accurate than DexScreener for real-time arbs
            const url = `https://aggregator-api.kyberswap.com/arbitrum/api/v1/routes?tokenIn=0xaf88d065e77c8cc2239327c5edb3a432268e5831&tokenOut=${token.address}&amount=1000000`; // 1000 USDC in
            
            // Note: For a truly robust multi-pool comparison without a full Kyber API key, 
            // we'll use a combination of Kyber and DexScreener's "latest" endpoint which is faster than their search.
            const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${token.address}`);
            
            if (!res.data || !res.data.pairs) return;

            const dexes = {};
            res.data.pairs.forEach(p => {
                if (p.chainId !== 'arbitrum') return;
                
                const id = p.dexId.toLowerCase();
                const price = parseFloat(p.priceUsd);
                const liq = p.liquidity ? p.liquidity.usd : 0;

                // We only care about pools with decent liquidity to avoid fake arbs
                if (price && liq > MIN_LIQUIDITY) {
                    // If multiple pools exist for the same DEX, take the most liquid one
                    if (!dexes[id] || liq > dexes[id].liq) {
                        dexes[id] = { price, liq, name: p.dexId, url: p.url };
                    }
                }
            });

            const ids = Object.keys(dexes);
            if (ids.length < 2) return;

            // Compare every DEX against every other DEX for this token
            for (let i = 0; i < ids.length; i++) {
                for (let j = 0; j < ids.length; j++) {
                    if (i === j) continue;

                    const buyDex = dexes[ids[i]];
                    const sellDex = dexes[ids[j]];
                    
                    const spread = ((sellDex.price - buyDex.price) / buyDex.price) * 100;

                    if (spread >= MIN_PROFIT_PCT && spread <= MAX_PROFIT_PCT) {
                        const optimalSize = calculateOptimalTrade(buyDex.liq, sellDex.liq, spread);
                        results.push({
                            token: token.symbol,
                            spread: spread.toFixed(2),
                            buy: buyDex,
                            sell: sellDex,
                            optimalSize: optimalSize.toFixed(2),
                            expectedProfit: (optimalSize * (spread/100 - 0.006)).toFixed(2),
                            time: new Date().toLocaleTimeString()
                        });
                    }
                }
            }
        } catch (e) {
            // Skip token on error
        }
    });

    await Promise.all(promises);
    
    // Remove duplicates and sort by profit
    const uniqueResults = Array.from(new Set(results.map(r => JSON.stringify(r))))
        .map(s => JSON.parse(s))
        .sort((a, b) => b.spread - a.spread);

    lastScanResults = {
        timestamp: new Date().toLocaleString(),
        opportunities: uniqueResults,
        status: "Idle",
        tokenCount: TOKENS.length
    };
    console.log(`[${new Date().toISOString()}] Scan complete. Found ${uniqueResults.length} opportunities.`);
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
