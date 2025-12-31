const express = require('express');
const { ethers } = require('ethers');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const MIN_PROFIT_PCT = 0.5;
const MAX_PROFIT_PCT = 15;
const SCAN_INTERVAL = 60 * 1000; // 1 minute

// RPC Configuration
const RPC_URL = process.env.RPC_URL || "https://rpc.ankr.com/arbitrum";
const provider = new ethers.JsonRpcProvider(RPC_URL, 42161, { staticNetwork: true });

// REMOTE TOKEN LIST CONFIG
const REMOTE_TOKEN_LIST_URL = process.env.TOKEN_LIST_URL || null;

// ABIs
const FACTORY_ABI = ["function getPair(address tokenA, address tokenB) external view returns (address pair)"];
const V2_PAIR_ABI = ["function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)", "function token0() external view returns (address)"];
const GMX_VAULT_ABI = ["function getMinPrice(address _token) external view returns (uint256)", "function getMaxPrice(address _token) external view returns (uint256)"];

// DEX Factories & Contracts
const DEXS = [
    { name: "SushiSwap", factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4" },
    { name: "Camelot", factory: "0x6EcCab422D763aC031210895C81787E87B43A652" }
];
const GMX_VAULT = "0x489ee07299453A0E6AffAC5104484e9fd6E06913";
const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

let TOKENS = [
    { symbol: "ARB", address: "0x912ce59144191c1204e64559fe8253a0e49e6548" },
    { symbol: "LINK", address: "0xf97f4df75117a78c1a5a0dbb814af92458539fb4" }
];

let lastScanResults = { timestamp: null, opportunities: [], status: "Initializing...", tokenCount: TOKENS.length };

async function updateTokenList() {
    if (!REMOTE_TOKEN_LIST_URL) return;
    try {
        const res = await axios.get(REMOTE_TOKEN_LIST_URL);
        if (Array.isArray(res.data)) {
            TOKENS = res.data;
            lastScanResults.tokenCount = TOKENS.length;
        }
    } catch (e) { console.error("Gist fetch failed:", e.message); }
}

async function getGMXPrice(tokenAddress) {
    try {
        const vault = new ethers.Contract(GMX_VAULT, GMX_VAULT_ABI, provider);
        const minPrice = await vault.getMinPrice(tokenAddress);
        const maxPrice = await vault.getMaxPrice(tokenAddress);
        // GMX prices are 30 decimals
        return (Number(minPrice + maxPrice) / 2) / 1e30;
    } catch (e) { return null; }
}

async function getV2Price(factoryAddress, tokenAddress) {
    try {
        const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
        const pairAddress = await factory.getPair(tokenAddress, USDC);
        if (pairAddress === ethers.ZeroAddress) return null;

        const pair = new ethers.Contract(pairAddress, V2_PAIR_ABI, provider);
        const reserves = await pair.getReserves();
        const token0 = await pair.token0();
        
        // Determine which reserve is USDC (6 decimals) and which is Token (usually 18)
        const isToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
        const reserveToken = isToken0 ? reserves[0] : reserves[1];
        const reserveUSDC = isToken0 ? reserves[1] : reserves[0];

        const price = (Number(reserveUSDC) / 1e6) / (Number(reserveToken) / 1e18);
        return { price, liq: Number(reserveUSDC) / 1e6 };
    } catch (e) { return null; }
}

async function runScan() {
    console.log(`[${new Date().toISOString()}] Starting Advanced On-Chain Scan...`);
    lastScanResults.status = "Scanning...";
    await updateTokenList();
    
    const results = [];
    for (const token of TOKENS) {
        const prices = [];
        
        // 1. Get GMX Price
        const gmxPrice = await getGMXPrice(token.address);
        if (gmxPrice) prices.push({ name: "GMX Vault", price: gmxPrice, liq: 1000000 });

        // 2. Get V2 DEX Prices
        for (const dex of DEXS) {
            const data = await getV2Price(dex.factory, token.address);
            if (data) prices.push({ name: dex.name, ...data });
        }

        // 3. Compare
        for (let i = 0; i < prices.length; i++) {
            for (let j = 0; j < prices.length; j++) {
                if (i === j) continue;
                const spread = ((prices[j].price - prices[i].price) / prices[i].price) * 100;
                if (spread >= MIN_PROFIT_PCT && spread <= MAX_PROFIT_PCT) {
                    results.push({
                        token: token.symbol,
                        spread: spread.toFixed(2),
                        buy: { name: prices[i].name, price: prices[i].price },
                        sell: { name: prices[j].name, price: prices[j].price },
                        optimalSize: (prices[i].liq * 0.005).toFixed(2),
                        expectedProfit: ((prices[i].liq * 0.005) * (spread/100 - 0.006)).toFixed(2),
                        time: new Date().toLocaleTimeString()
                    });
                }
            }
        }
    }

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
app.get('/', (req, res) => res.render('index', { data: lastScanResults }));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
