const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const MIN_LIQUIDITY = 2000;
const MIN_PROFIT_PCT = 0.5;
const MAX_PROFIT_PCT = 15;
const SCAN_INTERVAL = 5 * 60 * 1000;

// State
let lastScanResults = {
    timestamp: null,
    opportunities: [],
    status: "Initializing..."
};

const TOKENS = [
    { symbol: "ARB", address: "0x912ce59144191c1204e64559fe8253a0e49e6548" },
    { symbol: "GMX", address: "0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a" },
    { symbol: "PENDLE", address: "0x0c880f6761f1af8d9aa9c466984b80dab9a8c9f8" },
    { symbol: "RDNT", address: "0x3082ccaa395b30b11d719a1369a3de17cd7307a7" },
    { symbol: "GRAIL", address: "0x3d9907f9a368ad0a51be60f191c97ae295912fbc" },
    { symbol: "JOE", address: "0x371c7ec6d8039ff7933a2aa28eb827ffe1f52f07" },
    { symbol: "STG", address: "0x6694348fc57cde48c9f07067843f240f7f670082" },
    { symbol: "LINK", address: "0xf97f4df75117a78c1a5a0dbb814af92458539fb4" },
    { symbol: "MAGIC", address: "0x539bde0d7dbd3f83b7799d67e4f353957c0030d6" }
];

/**
 * Calculates the optimal trade size to minimize slippage while maximizing profit.
 * Rule: Never use more than 0.5% of the pool to keep price impact < 0.1%.
 */
function calculateOptimalTrade(buyLiq, sellLiq, spread) {
    const poolBottleneck = Math.min(buyLiq, sellLiq);
    
    // Base optimal size is 0.5% of the bottleneck liquidity
    let optimalSize = poolBottleneck * 0.005;
    
    // Adjust based on spread - tighter spreads need even lower slippage
    if (spread < 1.0) {
        optimalSize = optimalSize * 0.5; // Reduce size for thin margins
    }
    
    return Math.max(optimalSize, 0);
}

async function runScan() {
    console.log(`[${new Date().toISOString()}] Starting enhanced scan...`);
    lastScanResults.status = "Scanning...";
    
    const results = [];
    const promises = TOKENS.map(async (token) => {
        try {
            const res = await axios.get(`https://api.dexscreener.com/token-pairs/v1/arbitrum/${token.address}`);
            if (!res.data || !Array.isArray(res.data)) return;

            const dexes = {};
            res.data.forEach(p => {
                const id = p.dexId.toLowerCase();
                const price = parseFloat(p.priceUsd);
                const liq = p.liquidity ? p.liquidity.usd : 0;

                if (price && liq > MIN_LIQUIDITY) {
                    if (!dexes[id] || liq > dexes[id].liq) {
                        dexes[id] = { price, liq, name: p.dexId, url: p.url };
                    }
                }
            });

            const ids = Object.keys(dexes);
            if (ids.length < 2) return;

            let min = ids[0], max = ids[0];
            ids.forEach(id => {
                if (dexes[id].price < dexes[min].price) min = id;
                if (dexes[id].price > dexes[max].price) max = id;
            });

            const spread = ((dexes[max].price - dexes[min].price) / dexes[min].price) * 100;

            if (spread >= MIN_PROFIT_PCT && spread <= MAX_PROFIT_PCT) {
                const optimalSize = calculateOptimalTrade(dexes[min].liq, dexes[max].liq, spread);
                
                results.push({
                    token: token.symbol,
                    spread: spread.toFixed(2),
                    buy: dexes[min],
                    sell: dexes[max],
                    optimalSize: optimalSize.toFixed(2),
                    expectedProfit: (optimalSize * (spread/100 - 0.006)).toFixed(2), // Subtracting 0.6% fees
                    time: new Date().toLocaleTimeString()
                });
            }
        } catch (e) {
            console.error(`Error scanning ${token.symbol}: ${e.message}`);
        }
    });

    await Promise.all(promises);
    
    lastScanResults = {
        timestamp: new Date().toLocaleString(),
        opportunities: results.sort((a, b) => b.spread - a.spread),
        status: "Idle"
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
