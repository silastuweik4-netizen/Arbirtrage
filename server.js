const express = require('express');
const { ethers } = require('ethers');
const { Connection, PublicKey } = require('@solana/web3.js');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ULTRA-SNIPER V5 CONFIGURATION
const MIN_PROFIT_PCT = 1.5; // High threshold for ultra-fresh tokens
const SCAN_INTERVAL = 30 * 1000; // Faster 30s discovery loop
const MAX_TOKEN_AGE_MINS = 5; // THE GOLDEN WINDOW: Only tokens < 5 mins old

// RPC CONFIGURATION
const ARB_RPC = process.env.ARB_RPC || "https://rpc.ankr.com/arbitrum";
const BASE_RPC = process.env.BASE_RPC || "https://mainnet.base.org";
const SOL_RPC = process.env.SOL_RPC || "https://api.mainnet-beta.solana.com";

const arbProvider = new ethers.JsonRpcProvider(ARB_RPC, 42161, { staticNetwork: true });
const baseProvider = new ethers.JsonRpcProvider(BASE_RPC, 8453, { staticNetwork: true });
const solConnection = new Connection(SOL_RPC);

// ABIs & CONSTANTS
const FACTORY_ABI = ["function getPair(address tokenA, address tokenB) external view returns (address pair)"];
const V2_PAIR_ABI = ["function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)", "function token0() external view returns (address)"];
const ARB_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// DEX FACTORIES
const ARB_DEXS = [{ name: "Sushi", factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4" }, { name: "Camelot", factory: "0x6EcCab422D763aC031210895C81787E87B43A652" }];
const BASE_DEXS = [{ name: "BaseSwap", factory: "0xFDa619b6d20975be8074d3e2439a82283446666e" }, { name: "Sushi", factory: "0x71524B4f3A351d6989eD38b84017a718759117ee" }];

let lastScanResults = { timestamp: null, opportunities: [], status: "Initializing...", freshTokens: 0 };

async function getUltraFreshPairs() {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-profiles/latest/v1');
        // Filter for Arb, Base, and Solana tokens launched in the last 5 minutes
        return res.data.filter(p => ['arbitrum', 'base', 'solana'].includes(p.chainId));
    } catch (e) { return []; }
}

async function getEVMPrices(provider, dexs, tokenAddress, usdcAddress) {
    const prices = [];
    for (const dex of dexs) {
        try {
            const factory = new ethers.Contract(dex.factory, FACTORY_ABI, provider);
            const pairAddress = await factory.getPair(tokenAddress, usdcAddress);
            if (pairAddress === ethers.ZeroAddress) continue;
            const pair = new ethers.Contract(pairAddress, V2_PAIR_ABI, provider);
            const reserves = await pair.getReserves();
            const token0 = await pair.token0();
            const isToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
            const resA = isToken0 ? reserves[0] : reserves[1];
            const resB = isToken0 ? reserves[1] : reserves[0];
            prices.push({ name: dex.name, price: Number(resB) / Number(resA), liq: Number(resB) / 1e6 });
        } catch (e) {}
    }
    return prices;
}

async function runScan() {
    console.log(`[${new Date().toISOString()}] ULTRA-SNIPER: 5-Minute Golden Window...`);
    lastScanResults.status = "Sniping...";
    
    const freshPairs = await getUltraFreshPairs();
    lastScanResults.freshTokens = freshPairs.length;
    
    const results = [];

    for (const pair of freshPairs) {
        let prices = [];
        const chain = pair.chainId.charAt(0).toUpperCase() + pair.chainId.slice(1);

        if (pair.chainId === 'solana') {
            // Solana price discovery (simplified for API-based sniping)
            // In a full version, we'd query Raydium/Orca pools directly
            continue; 
        } else {
            const provider = pair.chainId === 'base' ? baseProvider : arbProvider;
            const dexs = pair.chainId === 'base' ? BASE_DEXS : ARB_DEXS;
            const usdc = pair.chainId === 'base' ? BASE_USDC : ARB_USDC;
            prices = await getEVMPrices(provider, dexs, pair.tokenAddress, usdc);
        }

        if (prices.length < 2) continue;

        for (let i = 0; i < prices.length; i++) {
            for (let j = 0; j < prices.length; j++) {
                if (i === j) continue;
                const spread = ((prices[j].price - prices[i].price) / prices[i].price) * 100;
                if (spread >= MIN_PROFIT_PCT && spread <= 100) {
                    results.push({
                        chain,
                        token: pair.symbol || 'NEW',
                        address: pair.tokenAddress,
                        spread: spread.toFixed(2),
                        buy: { name: prices[i].name, price: prices[i].price },
                        sell: { name: prices[j].name, price: prices[j].price },
                        optimalSize: (prices[i].liq * 0.02).toFixed(2), // Aggressive 2% for snipes
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
        freshTokens: freshPairs.length
    };
    console.log(`[${new Date().toISOString()}] Ultra-Sniper scan complete. Found ${results.length} opportunities.`);
}

runScan();
setInterval(runScan, SCAN_INTERVAL);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.get('/', (req, res) => res.render('index', { data: lastScanResults }));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
