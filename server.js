const express = require('express');
const { ethers } = require('ethers');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// HUNTER CONFIGURATION
const MIN_LIQUIDITY = 500;
const MIN_PROFIT_PCT = 0.8;
const MAX_PROFIT_PCT = 25;
const SCAN_INTERVAL = 60 * 1000;

// RPC CONFIGURATION
const ARB_RPC = process.env.ARB_RPC || "https://rpc.ankr.com/arbitrum";
const BASE_RPC = process.env.BASE_RPC || "https://mainnet.base.org";

const arbProvider = new ethers.JsonRpcProvider(ARB_RPC, 42161, { staticNetwork: true });
const baseProvider = new ethers.JsonRpcProvider(BASE_RPC, 8453, { staticNetwork: true });

// ABIs
const FACTORY_ABI = ["function getPair(address tokenA, address tokenB) external view returns (address pair)"];
const V2_PAIR_ABI = ["function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)", "function token0() external view returns (address)"];

// DEX CONFIGURATION
const ARB_DEXS = [
    { name: "SushiSwap", factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4" },
    { name: "Camelot", factory: "0x6EcCab422D763aC031210895C81787E87B43A652" },
    { name: "PancakeSwap", factory: "0x02a84c1b3BBD7401a5f7fa98a2183E4818039670" }
];

const BASE_DEXS = [
    { name: "BaseSwap", factory: "0xFDa619b6d20975be8074d3e2439a82283446666e" },
    { name: "SushiSwap", factory: "0x71524B4f3A351d6989eD38b84017a718759117ee" },
    { name: "Uniswap V2", factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6" }
];

const ARB_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// HARDCODED BASE TOKENS (Fallback)
const BASE_TOKENS = [
    { symbol: "BRETT", address: "0x532f27101965dd163b953190d170700b98815dca" },
    { symbol: "DEGEN", address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed" },
    { symbol: "TOSHI", address: "0xac1bd2465a5c5625037dd606695110b9f0ae6d06" },
    { symbol: "AERO", address: "0x9401518c4c1ee242c45418078b1b9ba595ac459c" },
    { symbol: "NORMIE", address: "0x7f12d13b34f5f4f0a9449c16bcd42f0da47af200" },
    { symbol: "MIGGLES", address: "0xb35e9c60462bdc9a7271d763300ee3f40b50a088" },
    { symbol: "KEYCAT", address: "0x9a26f543d9fd5f36c2239726902ac161cb048a2b" },
    { symbol: "BASENJI", address: "0x70a423531169c6d2ca933878847520554d66e9c1" },
    { symbol: "MOCHI", address: "0xf6e9327e45685cf6919096dec05a33a036ca3c5a" },
    { symbol: "BENJI", address: "0xbc45647f9d4e71e5ca999f8997765242a8484474" },
    { symbol: "CHOMPY", address: "0x05a61f0551982f039604405a7058f771942f0340" },
    { symbol: "TYBGS", address: "0x0d97f5cd5422454d6c64768e8d6589c25f0e77d4" },
    { symbol: "COIN", address: "0x1234567890123456789012345678901234567890" }, // Placeholder
    { symbol: "BASE", address: "0x8d01f9bcca9bc464646464646464646464646464" }, // Placeholder
    { symbol: "HIGHER", address: "0x05787a11a8235a31166d2683506a5f5524c12c71" },
    { symbol: "LUM", address: "0x1234567890123456789012345678901234567891" }, // Placeholder
    { symbol: "MFER", address: "0xe3086852a4b125803c815a158249ae468a3254ca" },
    { symbol: "SKOP", address: "0x1234567890123456789012345678901234567892" }, // Placeholder
    { symbol: "BOOMER", address: "0x444696eb62947b9513964442897987383b749340" },
    { symbol: "WOCK", address: "0x1234567890123456789012345678901234567893" } // Placeholder
];

let ARB_TOKENS = [
    { symbol: "ARB", address: "0x912ce59144191c1204e64559fe8253a0e49e6548" },
    { symbol: "GMX", address: "0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a" }
];

let lastScanResults = { timestamp: null, opportunities: [], status: "Initializing...", tokenCount: 0 };

async function updateTokenList() {
    const REMOTE_URL = process.env.TOKEN_LIST_URL;
    if (!REMOTE_URL) return;
    try {
        const res = await axios.get(REMOTE_URL);
        if (res.data && res.data.arbitrum) ARB_TOKENS = res.data.arbitrum;
        // If Gist has a base list, we can use it too
    } catch (e) { console.error("Gist fetch failed:", e.message); }
}

async function getV2Price(provider, factoryAddress, tokenAddress, usdcAddress) {
    try {
        const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
        const pairAddress = await factory.getPair(tokenAddress, usdcAddress);
        if (pairAddress === ethers.ZeroAddress) return null;

        const pair = new ethers.Contract(pairAddress, V2_PAIR_ABI, provider);
        const reserves = await pair.getReserves();
        const token0 = await pair.token0();
        
        const isToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
        const reserveToken = isToken0 ? reserves[0] : reserves[1];
        const reserveUSDC = isToken0 ? reserves[1] : reserves[0];

        if (Number(reserveUSDC) < MIN_LIQUIDITY * 1e6) return null;

        const price = (Number(reserveUSDC) / 1e6) / (Number(reserveToken) / 1e18);
        return { price, liq: Number(reserveUSDC) / 1e6 };
    } catch (e) { return null; }
}

async function scanChain(chainName, provider, dexs, tokens, usdcAddress) {
    const results = [];
    const CHUNK_SIZE = 5;
    for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
        const chunk = tokens.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(async (token) => {
            const prices = [];
            for (const dex of dexs) {
                const data = await getV2Price(provider, dex.factory, token.address, usdcAddress);
                if (data) prices.push({ name: dex.name, ...data });
            }
            if (prices.length < 2) return;
            for (let i = 0; i < prices.length; i++) {
                for (let j = 0; j < prices.length; j++) {
                    if (i === j) continue;
                    const spread = ((prices[j].price - prices[i].price) / prices[i].price) * 100;
                    if (spread >= MIN_PROFIT_PCT && spread <= MAX_PROFIT_PCT) {
                        const optimalSize = (prices[i].liq * 0.005).toFixed(2);
                        results.push({
                            chain: chainName,
                            token: token.symbol,
                            spread: spread.toFixed(2),
                            buy: { name: prices[i].name, price: prices[i].price },
                            sell: { name: prices[j].name, price: prices[j].price },
                            optimalSize,
                            expectedProfit: (optimalSize * (spread/100 - 0.006)).toFixed(2),
                            time: new Date().toLocaleTimeString()
                        });
                    }
                }
            }
        }));
    }
    return results;
}

async function runScan() {
    console.log(`[${new Date().toISOString()}] DUAL-CHAIN HUNT: Arbitrum + Base...`);
    lastScanResults.status = "Hunting...";
    await updateTokenList();
    
    const arbResults = await scanChain("Arbitrum", arbProvider, ARB_DEXS, ARB_TOKENS, ARB_USDC);
    const baseResults = await scanChain("Base", baseProvider, BASE_DEXS, BASE_TOKENS, BASE_USDC);

    const allResults = [...arbResults, ...baseResults];
    lastScanResults = {
        timestamp: new Date().toLocaleString(),
        opportunities: allResults.sort((a, b) => b.spread - a.spread),
        status: "Idle",
        tokenCount: ARB_TOKENS.length + BASE_TOKENS.length
    };
    console.log(`[${new Date().toISOString()}] Hunt complete. Found ${allResults.length} opportunities.`);
}

runScan();
setInterval(runScan, SCAN_INTERVAL);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.get('/', (req, res) => res.render('index', { data: lastScanResults }));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
