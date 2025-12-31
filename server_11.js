const express = require('express');
const { ethers } = require('ethers');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// HUNTER V3 CONFIGURATION
const MIN_PROFIT_PCT = 0.4; // Lowered for triangular high-frequency
const SCAN_INTERVAL = 45 * 1000;

// RPC CONFIGURATION
const ARB_RPC = process.env.ARB_RPC || "https://rpc.ankr.com/arbitrum";
const BASE_RPC = process.env.BASE_RPC || "https://mainnet.base.org";

const arbProvider = new ethers.JsonRpcProvider(ARB_RPC, 42161, { staticNetwork: true });
const baseProvider = new ethers.JsonRpcProvider(BASE_RPC, 8453, { staticNetwork: true });

// ABIs
const FACTORY_ABI = ["function getPair(address tokenA, address tokenB) external view returns (address pair)"];
const V2_PAIR_ABI = ["function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)", "function token0() external view returns (address)"];

// CORE ADDRESSES
const ARB_WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const ARB_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const BASE_WETH = "0x4200000000000000000000000000000000000006";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// DEX FACTORIES
const ARB_DEXS = [{ name: "Sushi", factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4" }, { name: "Camelot", factory: "0x6EcCab422D763aC031210895C81787E87B43A652" }];
const BASE_DEXS = [{ name: "BaseSwap", factory: "0xFDa619b6d20975be8074d3e2439a82283446666e" }, { name: "Sushi", factory: "0x71524B4f3A351d6989eD38b84017a718759117ee" }];

let TOKENS = [
    { symbol: "BRETT", address: "0x532f27101965dd163b953190d170700b98815dca", chain: "Base" },
    { symbol: "DEGEN", address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", chain: "Base" },
    { symbol: "ARB", address: "0x912ce59144191c1204e64559fe8253a0e49e6548", chain: "Arbitrum" }
];

let lastScanResults = { timestamp: null, opportunities: [], status: "Initializing...", livePrices: [] };

async function getV2Price(provider, factoryAddress, tokenA, tokenB) {
    try {
        const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
        const pairAddress = await factory.getPair(tokenA, tokenB);
        if (pairAddress === ethers.ZeroAddress) return null;
        const pair = new ethers.Contract(pairAddress, V2_PAIR_ABI, provider);
        const reserves = await pair.getReserves();
        const token0 = await pair.token0();
        const isToken0 = token0.toLowerCase() === tokenA.toLowerCase();
        const resA = isToken0 ? reserves[0] : reserves[1];
        const resB = isToken0 ? reserves[1] : reserves[0];
        return Number(resB) / Number(resA);
    } catch (e) { return null; }
}

async function runScan() {
    console.log(`[${new Date().toISOString()}] HIDDEN HUNTER: Triangular + New Listings...`);
    lastScanResults.status = "Hunting...";
    
    const results = [];
    const livePrices = [];

    for (const token of TOKENS) {
        const provider = token.chain === "Base" ? baseProvider : arbProvider;
        const dexs = token.chain === "Base" ? BASE_DEXS : ARB_DEXS;
        const weth = token.chain === "Base" ? BASE_WETH : ARB_WETH;
        const usdc = token.chain === "Base" ? BASE_USDC : ARB_USDC;

        for (const dex of dexs) {
            // Path: USDC -> WETH -> TOKEN -> USDC
            const p1 = await getV2Price(provider, dex.factory, usdc, weth); // USDC per WETH
            const p2 = await getV2Price(provider, dex.factory, weth, token.address); // WETH per TOKEN
            const p3 = await getV2Price(provider, dex.factory, token.address, usdc); // TOKEN per USDC

            if (p1 && p2 && p3) {
                const finalAmount = 1 * p1 * p2 * p3;
                const profit = (finalAmount - 1) * 100;
                
                livePrices.push({ chain: token.chain, token: token.symbol, dex: dex.name, price: p3 * (10**12) }); // Normalized to USDC

                if (profit >= MIN_PROFIT_PCT && profit <= MAX_PROFIT_PCT) {
                    results.push({
                        chain: token.chain,
                        token: token.symbol,
                        type: "Triangular",
                        spread: profit.toFixed(3),
                        path: `USDC → WETH → ${token.symbol} → USDC`,
                        dex: dex.name,
                        time: new Date().toLocaleTimeString()
                    });
                }
            }
        }
    }

    lastScanResults = {
        timestamp: new Date().toLocaleString(),
        opportunities: results.sort((a, b) => b.spread - a.spread),
        livePrices: livePrices.slice(0, 15),
        status: "Idle"
    };
    console.log(`[${new Date().toISOString()}] Hunt complete. Found ${results.length} hidden opportunities.`);
}

runScan();
setInterval(runScan, SCAN_INTERVAL);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.get('/', (req, res) => res.render('index', { data: lastScanResults }));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
