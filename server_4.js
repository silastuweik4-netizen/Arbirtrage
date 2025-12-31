const express = require('express');
const { ethers } = require('ethers');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const MIN_PROFIT_PCT = 0.5;
const MAX_PROFIT_PCT = 15;
const SCAN_INTERVAL = 30 * 1000; // 30 seconds (On-chain is fast!)

// RPC Configuration (Using public Arbitrum RPC)
const RPC_URL = process.env.RPC_URL || "https://arb1.arbitrum.io/rpc";
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Minimal ABI for Uniswap V2/V3 and Camelot
const UNISWAP_V2_PAIR_ABI = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
];

// Common Pool Addresses on Arbitrum (Example: WETH/USDC)
// In a real scenario, we'd fetch these dynamically or via a config
const POOLS = [
    { 
        name: "Uniswap V3 (WETH/USDC)", 
        address: "0xC6962024adABde73976993113b834e473579C739", 
        type: "v3",
        token0: "WETH",
        token1: "USDC"
    },
    { 
        name: "Camelot (WETH/USDC)", 
        address: "0x84652ad9372bc35583ae06733f82f935cc6bcad3", 
        type: "v2",
        token0: "WETH",
        token1: "USDC"
    },
    { 
        name: "SushiSwap (WETH/USDC)", 
        address: "0x905dfcd5649217c42684f23958568e533c711aa3", 
        type: "v2",
        token0: "WETH",
        token1: "USDC"
    }
];

// State
let lastScanResults = {
    timestamp: null,
    opportunities: [],
    status: "Initializing..."
};

/**
 * Fetches the real-time price from a V2-style pool (Sushi, Camelot V2)
 */
async function getV2Price(pool) {
    try {
        const contract = new ethers.Contract(pool.address, UNISWAP_V2_PAIR_ABI, provider);
        const reserves = await contract.getReserves();
        // Simplified price calculation (assuming token0 is WETH and token1 is USDC)
        // WETH has 18 decimals, USDC has 6
        const price = (Number(reserves[1]) / 10**6) / (Number(reserves[0]) / 10**18);
        return { price, liq: Number(reserves[1]) / 10**6 };
    } catch (e) {
        return null;
    }
}

/**
 * Fetches the real-time price from a V3-style pool (Uniswap V3)
 */
async function getV3Price(pool) {
    try {
        // V3 uses slot0 for price
        const V3_ABI = ["function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"];
        const contract = new ethers.Contract(pool.address, V3_ABI, provider);
        const slot0 = await contract.slot0();
        const sqrtPriceX96 = slot0[0];
        // Price = (sqrtPriceX96 / 2^96)^2 * 10^(decimalDiff)
        const price = (Number(sqrtPriceX96) / (2**96))**2 * (10**12);
        return { price, liq: 50000 }; // Placeholder liq for V3
    } catch (e) {
        return null;
    }
}

async function runScan() {
    console.log(`[${new Date().toISOString()}] Starting Direct On-Chain Scan...`);
    lastScanResults.status = "Scanning Blockchain...";
    
    const results = [];
    const prices = [];

    // Fetch all prices in parallel directly from the RPC
    for (const pool of POOLS) {
        let data;
        if (pool.type === "v2") data = await getV2Price(pool);
        else data = await getV3Price(pool);
        
        if (data) {
            prices.push({ ...pool, ...data });
        }
    }

    // Compare prices
    for (let i = 0; i < prices.length; i++) {
        for (let j = 0; j < prices.length; j++) {
            if (i === j) continue;

            const buy = prices[i];
            const sell = prices[j];
            const spread = ((sell.price - buy.price) / buy.price) * 100;

            if (spread >= MIN_PROFIT_PCT && spread <= MAX_PROFIT_PCT) {
                results.push({
                    token: "WETH/USDC",
                    spread: spread.toFixed(2),
                    buy: { name: buy.name, price: buy.price, url: "#" },
                    sell: { name: sell.name, price: sell.price, url: "#" },
                    optimalSize: (buy.liq * 0.005).toFixed(2),
                    expectedProfit: ((buy.liq * 0.005) * (spread/100 - 0.006)).toFixed(2),
                    time: new Date().toLocaleTimeString()
                });
            }
        }
    }

    lastScanResults = {
        timestamp: new Date().toLocaleString(),
        opportunities: results.sort((a, b) => b.spread - a.spread),
        status: "Idle"
    };
    console.log(`[${new Date().toISOString()}] Scan complete. Found ${results.length} on-chain opportunities.`);
}

runScan();
setInterval(runScan, SCAN_INTERVAL);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => {
    res.render('index', { data: lastScanResults });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
