const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const MIN_PROFIT_PCT = 0.5;
const MAX_PROFIT_PCT = 15;
const SCAN_INTERVAL = 1 * 60 * 1000; // 1 minute scan for high-speed data
const TRADE_AMOUNT_USDC = 1000; // We'll use 1000 USDC as our quote reference

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
 * Fetches a live quote from KyberSwap for a specific token.
 * This is a "Live" price based on current pool state.
 */
async function getKyberQuote(tokenAddress) {
    try {
        // USDC (Arbitrum) address: 0xaf88d065e77c8cc2239327c5edb3a432268e5831
        const usdcAddress = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
        const amountIn = TRADE_AMOUNT_USDC * 10**6; // 1000 USDC (6 decimals)
        
        const url = `https://aggregator-api.kyberswap.com/arbitrum/api/v1/routes?tokenIn=${usdcAddress}&tokenOut=${tokenAddress}&amountIn=${amountIn}`;
        
        const res = await axios.get(url, { timeout: 5000 });
        if (res.data && res.data.data && res.data.data.routeSummary) {
            const summary = res.data.data.routeSummary;
            return {
                price: parseFloat(summary.amountOut) / (10**18) / TRADE_AMOUNT_USDC, // Simplified price calc
                amountOut: summary.amountOut,
                route: summary.route,
                dex: "KyberSwap Aggregator"
            };
        }
    } catch (e) {
        return null;
    }
}

/**
 * Fetches individual pool data from GeckoTerminal (much faster than DexScreener)
 */
async function getGeckoPools(tokenAddress) {
    try {
        const url = `https://api.geckoterminal.com/api/v2/networks/arbitrum/tokens/${tokenAddress}/pools`;
        const res = await axios.get(url, { timeout: 5000 });
        if (res.data && res.data.data) {
            return res.data.data.map(pool => ({
                name: pool.attributes.name,
                dex: pool.relationships.dex.data.id,
                price: parseFloat(pool.attributes.token_price_usd),
                liq: parseFloat(pool.attributes.reserve_in_usd),
                url: `https://www.geckoterminal.com/arbitrum/pools/${pool.attributes.address}`
            }));
        }
    } catch (e) {
        return [];
    }
}

async function runScan() {
    console.log(`[${new Date().toISOString()}] Starting Zero-Lag Scan...`);
    lastScanResults.status = "Scanning...";
    
    await updateTokenList();
    
    const results = [];
    const promises = TOKENS.map(async (token) => {
        try {
            // 1. Get the "Live" Aggregated Price (The target price)
            const kyberQuote = await getKyberQuote(token.address);
            
            // 2. Get the "Raw" Pool Prices (The potential laggards)
            const pools = await getGeckoPools(token.address);
            
            if (!kyberQuote || pools.length === 0) return;

            pools.forEach(pool => {
                // Compare each individual pool against the Kyber Aggregated Price
                // If a pool is significantly cheaper than the Kyber quote, it's an arb!
                const spread = ((kyberQuote.price - pool.price) / pool.price) * 100;

                if (spread >= MIN_PROFIT_PCT && spread <= MAX_PROFIT_PCT && pool.liq > 2000) {
                    results.push({
                        token: token.symbol,
                        spread: spread.toFixed(2),
                        buy: { name: pool.name, price: pool.price, liq: pool.liq, url: pool.url },
                        sell: { name: "KyberSwap (Aggregated)", price: kyberQuote.price, liq: 1000000 }, // Aggregated liq is high
                        optimalSize: (pool.liq * 0.005).toFixed(2),
                        expectedProfit: ((pool.liq * 0.005) * (spread/100 - 0.006)).toFixed(2),
                        time: new Date().toLocaleTimeString()
                    });
                }
            });
        } catch (e) {
            // Skip token
        }
    });

    await Promise.all(promises);
    
    lastScanResults = {
        timestamp: new Date().toLocaleString(),
        opportunities: results.sort((a, b) => b.spread - a.spread),
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
