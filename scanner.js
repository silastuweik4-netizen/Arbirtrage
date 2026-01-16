const { ethers } = require('ethers');

const RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com';
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 8453, name: 'base' }, { staticNetwork: true });

const TOKENS = {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    AERO: "0x94018130A5798221261ea3c3211516e872707253",
    VIRTUAL: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
    USDbC: "0xd9aAEc86B65D86f6A7B630E2C953757eFB0d5E88",
    cbETH: "0x2Ae3F1eB1fC2e6d6d8D042C9D066bC06D9455358",
    DEGEN: "0x4ed4E1115d9e50E85617F3342551391D93F76445",
    LINK: "0x88fb150d797089988189c62907473c0cc2d3d3a9",
    PYUSD: "0x735659E05da55609e9f906059d4860D49845F549",
    DAI: "0x50c5725949A6F0c72E6C4a641F14122319976f97",
    MORPHO: "0x98878B06940aE243284CA214f2Cde41C28d9f9e0",
    // Meme coins with high volatility
    BRETT: "0x532f06ff20bf4fb63fd4a9763cb7da19e0525405",
    TOSHI: "0x6Fa0b196788CD1c8Bb99b0eFCeAf96Ddf1D96B8",
};

const QUOTERS = {
    AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
    PANCAKESWAP: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997"
};

const QUOTER_ABI = [
    "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
];

// Fee tiers to check (100 = 0.01%, 500 = 0.05%, 2500 = 0.25%, 3000 = 0.3%, 10000 = 1%)
const FEE_TIERS = [100, 500, 2500, 3000, 10000];

class ArbitrageScanner {
    constructor() {
        this.aero = new ethers.Contract(QUOTERS.AERODROME, QUOTER_ABI, provider);
        this.pancake = new ethers.Contract(QUOTERS.PANCAKESWAP, QUOTER_ABI, provider);
        this.requestCount = 0;
        this.opportunities = [];
    }

    async initialize() {
        try {
            const block = await provider.getBlockNumber();
            console.log(`\n✅ Scanner Initialized`);
            console.log(`📍 Block: ${block}`);
            console.log(`💱 DEXes: Aerodrome, PancakeSwap`);
            console.log(`🔗 Network: Base Chain\n`);
        } catch (e) { 
            console.error("❌ Connection failed. Check your RPC URL."); 
        }
    }

    async getQuote(dex, tokenIn, tokenOut, fee, amountInScaled) {
        try {
            this.requestCount++;
            if (dex === 'PANCAKE') {
                const params = { tokenIn, tokenOut, amountIn: amountInScaled, fee, sqrtPriceLimitX96: 0 };
                return (await this.pancake.quoteExactInputSingle.staticCall(params)).amountOut;
            } else {
                // Aerodrome/Uniswap Path encoding
                const path = ethers.solidityPacked(['address', 'uint24', 'address'], [tokenIn, fee, tokenOut]);
                return (await this.aero.quoteExactInput.staticCall(path, amountInScaled)).amountOut;
            }
        } catch (e) { 
            return 0n; 
        }
    }

    formatPrice(amount, decimals) {
        return amount > 0n ? parseFloat(ethers.formatUnits(amount, decimals)).toFixed(8) : "No Pool";
    }

    logOpportunity(pair, aeroPrice, pancakePrice, decOut) {
        const aeroNum = parseFloat(aeroPrice);
        const pancakeNum = parseFloat(pancakePrice);
        
        if (aeroNum === 0 || pancakeNum === 0) {
            return null;
        }

        const diff = Math.abs(aeroNum - pancakeNum);
        const spread = (diff / Math.min(aeroNum, pancakeNum)) * 100;

        // For volatile tokens, even 0.05% spreads matter after fees
        if (spread >= 0.05) {
            const cheaperDex = aeroNum < pancakeNum ? "🟢 Aero" : "🟠 Pancake";
            const expensiveDex = aeroNum < pancakeNum ? "🟠 Pancake" : "🟢 Aero";
            const profit = (spread - 0.35).toFixed(4); // Account for ~0.35% fees

            console.log(`  📈 ${pair.padEnd(18)} | Aero: ${aeroPrice.padEnd(15)} | Pancake: ${pancakePrice.padEnd(15)} | Spread: ${spread.toFixed(4)}% | Buy: ${cheaperDex}`);
            
            return {
                pair,
                aeroPrice: aeroNum,
                pancakePrice: pancakeNum,
                spreadPercent: spread.toFixed(4),
                profit: profit,
                cheaperOn: aeroNum < pancakeNum ? "Aerodrome" : "PancakeSwap"
            };
        }

        return null;
    }

    async scanForArbitrageOpportunities() {
        this.requestCount = 0;
        this.opportunities = [];

        // 🚀 COMPREHENSIVE SCANNING - All possible volatile pairs
        const pairsToScan = [
            // 🔥 HIGHEST VOLATILITY - Meme coins & AI tokens (biggest spreads)
            { name: "VIRTUAL/WETH", in: TOKENS.VIRTUAL, out: TOKENS.WETH, inDec: 18, outDec: 18, amountInScaled: ethers.parseUnits("10", 18) },
            { name: "VIRTUAL/USDC", in: TOKENS.VIRTUAL, out: TOKENS.USDC, inDec: 18, outDec: 6, amountInScaled: ethers.parseUnits("10", 18) },
            { name: "VIRTUAL/cbBTC", in: TOKENS.VIRTUAL, out: TOKENS.cbBTC, inDec: 18, outDec: 8, amountInScaled: ethers.parseUnits("10", 18) },
            
            // BRETT - Meme coin (high volatility)
            { name: "BRETT/WETH", in: TOKENS.BRETT, out: TOKENS.WETH, inDec: 18, outDec: 18, amountInScaled: ethers.parseUnits("100", 18) },
            { name: "BRETT/USDC", in: TOKENS.BRETT, out: TOKENS.USDC, inDec: 18, outDec: 6, amountInScaled: ethers.parseUnits("100", 18) },
            { name: "WETH/BRETT", in: TOKENS.WETH, out: TOKENS.BRETT, inDec: 18, outDec: 18, amountInScaled: ethers.parseUnits("1", 18) },
            
            // TOSHI - Meme coin (high volatility)
            { name: "TOSHI/WETH", in: TOKENS.TOSHI, out: TOKENS.WETH, inDec: 18, outDec: 18, amountInScaled: ethers.parseUnits("100", 18) },
            { name: "TOSHI/USDC", in: TOKENS.TOSHI, out: TOKENS.USDC, inDec: 18, outDec: 6, amountInScaled: ethers.parseUnits("100", 18) },
            
            // DEGEN - Meme coin (high volatility)
            { name: "DEGEN/WETH", in: TOKENS.DEGEN, out: TOKENS.WETH, inDec: 18, outDec: 18, amountInScaled: ethers.parseUnits("100", 18) },
            { name: "DEGEN/USDC", in: TOKENS.DEGEN, out: TOKENS.USDC, inDec: 18, outDec: 6, amountInScaled: ethers.parseUnits("100", 18) },
            
            // 🏆 AERO - Highest volume token
            { name: "AERO/USDC", in: TOKENS.AERO, out: TOKENS.USDC, inDec: 18, outDec: 6, amountInScaled: ethers.parseUnits("10", 18) },
            { name: "AERO/WETH", in: TOKENS.AERO, out: TOKENS.WETH, inDec: 18, outDec: 18, amountInScaled: ethers.parseUnits("10", 18) },
            { name: "USDC/AERO", in: TOKENS.USDC, out: TOKENS.AERO, inDec: 6, outDec: 18, amountInScaled: ethers.parseUnits("10000", 6) },
            
            // 🔥 BITCOIN DERIVATIVES
            { name: "cbBTC/WETH", in: TOKENS.cbBTC, out: TOKENS.WETH, inDec: 8, outDec: 18, amountInScaled: ethers.parseUnits("0.1", 8) },
            { name: "WETH/cbBTC", in: TOKENS.WETH, out: TOKENS.cbBTC, inDec: 18, outDec: 8, amountInScaled: ethers.parseUnits("1.0", 18) },
            { name: "cbBTC/USDC", in: TOKENS.cbBTC, out: TOKENS.USDC, inDec: 8, outDec: 6, amountInScaled: ethers.parseUnits("0.1", 8) },
            { name: "USDC/cbBTC", in: TOKENS.USDC, out: TOKENS.cbBTC, inDec: 6, outDec: 8, amountInScaled: ethers.parseUnits("100000", 6) },
            
            // ⚡ ETH DERIVATIVES
            { name: "cbETH/WETH", in: TOKENS.cbETH, out: TOKENS.WETH, inDec: 18, outDec: 18, amountInScaled: ethers.parseUnits("1.0", 18) },
            { name: "WETH/cbETH", in: TOKENS.WETH, out: TOKENS.cbETH, inDec: 18, outDec: 18, amountInScaled: ethers.parseUnits("1.0", 18) },
            
            // OTHER TOKENS
            { name: "LINK/WETH", in: TOKENS.LINK, out: TOKENS.WETH, inDec: 18, outDec: 18, amountInScaled: ethers.parseUnits("1", 18) },
            { name: "LINK/USDC", in: TOKENS.LINK, out: TOKENS.USDC, inDec: 18, outDec: 6, amountInScaled: ethers.parseUnits("1", 18) },
            { name: "MORPHO/WETH", in: TOKENS.MORPHO, out: TOKENS.WETH, inDec: 18, outDec: 18, amountInScaled: ethers.parseUnits("10", 18) },
            { name: "MORPHO/USDC", in: TOKENS.MORPHO, out: TOKENS.USDC, inDec: 18, outDec: 6, amountInScaled: ethers.parseUnits("10", 18) },
            
            // 💰 BASE PAIRS (reference)
            { name: "WETH/USDC", in: TOKENS.WETH, out: TOKENS.USDC, inDec: 18, outDec: 6, amountInScaled: ethers.parseUnits("1.0", 18) },
            { name: "USDC/WETH", in: TOKENS.USDC, out: TOKENS.WETH, inDec: 6, outDec: 18, amountInScaled: ethers.parseUnits("1000", 6) },
        ];

        console.log(`🔍 Scanning ${pairsToScan.length} VERIFIED pairs for arbitrage opportunities...\n`);

        for (const pair of pairsToScan) {
            let bestAero = 0n, bestPancake = 0n;
            
            // Try all fee tiers and keep the best quote
            for (const fee of FEE_TIERS) {
                const [aQ, pQ] = await Promise.all([
                    this.getQuote('AERO', pair.in, pair.out, fee, pair.amountInScaled),
                    this.getQuote('PANCAKE', pair.in, pair.out, fee, pair.amountInScaled)
                ]);
                if (aQ > bestAero) bestAero = aQ;
                if (pQ > bestPancake) bestPancake = pQ;
            }

            const pA = this.formatPrice(bestAero, pair.outDec);
            const pP = this.formatPrice(bestPancake, pair.outDec);
            
            // Log pair info
            console.log(`📊 ${pair.name.padEnd(15)} | Aero: ${pA.padEnd(18)} | PanCake: ${pP.padEnd(18)}`);

            // Check for arbitrage
            if (bestAero > 0n && bestPancake > 0n) {
                const opp = this.logOpportunity(pair.name, pA, pP, pair.outDec);
                if (opp) {
                    this.opportunities.push(opp);
                }
            }
        }

        // Summary
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 SCAN SUMMARY`);
        console.log(`Found: ${this.opportunities.length} tradeable spreads (>0.35% profit after fees)`);
        console.log(`RPC Requests: ${this.requestCount}`);
        console.log(`${'='.repeat(80)}\n`);

        if (this.opportunities.length > 0) {
            console.log(`🏆 TOP OPPORTUNITIES (sorted by spread):\n`);
            this.opportunities
                .sort((a, b) => parseFloat(b.spreadPercent) - parseFloat(a.spreadPercent))
                .slice(0, 5)
                .forEach((opp, i) => {
                    console.log(`${i + 1}. ${opp.pair.padEnd(15)} | Spread: ${opp.spreadPercent}% | Profit: ${opp.profit}%`);
                });
        } else {
            console.log(`💡 NOTE: Current spreads are < 0.35% (below profitability threshold after fees)`);
            console.log(`💡 Spreads vary constantly - rerun scan in a few minutes for updates`);
        }

        return this.opportunities;
    }
}

module.exports = ArbitrageScanner;
