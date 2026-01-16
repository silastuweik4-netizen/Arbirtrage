const { ethers } = require('ethers');
const ThreeWayArbitrageCalculator = require('./threeWayArbitrageCalculator');

const RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com';
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 8453, name: 'base' }, { staticNetwork: true });

const QUOTERS = {
    AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
    UNISWAP: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0", // Uni v3 quoter on Base
    PANCAKESWAP: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997"
};

const FEE_TIERS = [100, 500, 2500, 3000, 10000];
const QUOTER_ABI = [
    "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
];

class ThreeWayScanner {
    constructor() {
        this.aero = new ethers.Contract(QUOTERS.AERODROME, QUOTER_ABI, provider);
        this.uniswap = new ethers.Contract(QUOTERS.UNISWAP, QUOTER_ABI, provider);
        this.pancake = new ethers.Contract(QUOTERS.PANCAKESWAP, QUOTER_ABI, provider);
        this.profitCalc = new ThreeWayArbitrageCalculator();
        this.requestCount = 0;
        this.opportunities = [];
    }

    async initialize() {
        try {
            const block = await provider.getBlockNumber();
            console.log(`\n✅ 3-Way Arbitrage Scanner Initialized`);
            console.log(`📍 Block: ${block}`);
            console.log(`🏢 DEXes: Aerodrome, Uniswap V3, PancakeSwap`);
            console.log(`📊 Pairs to scan: ${this.profitCalc.PAIR_DATA.length}\n`);
        } catch (e) { 
            console.error("❌ Connection failed"); 
        }
    }

    async getQuote(dex, tokenIn, tokenOut, fee, amountInScaled) {
        try {
            this.requestCount++;
            const contract = dex === 'PANCAKE' ? this.pancake : (dex === 'UNI' ? this.uniswap : this.aero);
            
            if (dex === 'PANCAKE' || dex === 'UNI') {
                const params = { tokenIn, tokenOut, amountIn: amountInScaled, fee, sqrtPriceLimitX96: 0 };
                return (await contract.quoteExactInputSingle.staticCall(params)).amountOut;
            } else {
                // Aerodrome
                const path = ethers.solidityPacked(['address', 'uint24', 'address'], [tokenIn, fee, tokenOut]);
                return (await contract.quoteExactInput.staticCall(path, amountInScaled)).amountOut;
            }
        } catch (e) { 
            return 0n; 
        }
    }

    formatPrice(amount, decimals) {
        return amount > 0n ? parseFloat(ethers.formatUnits(amount, decimals)) : 0;
    }

    async scanForArbitrageOpportunities() {
        this.requestCount = 0;
        this.opportunities = [];

        console.log(`🔍 Scanning ${this.profitCalc.PAIR_DATA.length} pairs across 3 DEXes...\n`);

        for (const pairData of this.profitCalc.PAIR_DATA) {
            // Get best quotes from each DEX
            let bestAero = 0n, bestUni = 0n, bestPancake = 0n;
            
            for (const fee of FEE_TIERS) {
                const [aQ, uQ, pQ] = await Promise.all([
                    this.getQuote('AERO', pairData.token0, pairData.token1, fee, pairData.amountInScaled),
                    this.getQuote('UNI', pairData.token0, pairData.token1, fee, pairData.amountInScaled),
                    this.getQuote('PANCAKE', pairData.token0, pairData.token1, fee, pairData.amountInScaled)
                ]);
                
                if (aQ > bestAero) bestAero = aQ;
                if (uQ > bestUni) bestUni = uQ;
                if (pQ > bestPancake) bestPancake = pQ;
            }

            // Format prices
            const aeroPrice = this.formatPrice(bestAero, pairData.outDec);
            const uniPrice = this.formatPrice(bestUni, pairData.outDec);
            const pancakePrice = this.formatPrice(bestPancake, pairData.outDec);
            
            console.log(`📊 ${pairData.pair.padEnd(20)} | Aero: ${aeroPrice.toFixed(6).padEnd(12)} | Uni: ${uniPrice.toFixed(6).padEnd(12)} | PanCake: ${pancakePrice.toFixed(6).padEnd(12)}`);

            // Calculate profitability
            if (aeroPrice > 0 && uniPrice > 0 && pancakePrice > 0) {
                const profitAnalysis = this.profitCalc.findBestRoute({
                    pair: pairData.pair,
                    fee: pairData.fee,
                    aero: aeroPrice,
                    uni: uniPrice,
                    pancake: pancakePrice
                });

                if (profitAnalysis.isProfitable) {
                    const recommendation = this.profitCalc.getRecommendation(profitAnalysis.netBp);
                    console.log(`   ${recommendation}`);
                    console.log(`   Buy: ${profitAnalysis.buyDex} @ ${profitAnalysis.buyPrice.toFixed(6)} → Sell: ${profitAnalysis.sellDex} @ ${profitAnalysis.sellPrice.toFixed(6)}`);
                    console.log(`   Profit: ${profitAnalysis.netBp} bp = $${profitAnalysis.profitPer100k}/100k = $${profitAnalysis.profitPer1M}/1M\n`);

                    this.opportunities.push(profitAnalysis);
                } else {
                    console.log(`   ❌ Not profitable: ${profitAnalysis.netBp} bp\n`);
                }
            }
        }

        // Summary
        console.log(`${'='.repeat(80)}`);
        console.log(`📊 SCAN SUMMARY`);
        console.log(`Profitable Opportunities: ${this.opportunities.length}`);
        console.log(`RPC Requests: ${this.requestCount}`);
        console.log(`${'='.repeat(80)}\n`);

        if (this.opportunities.length > 0) {
            console.log(`🏆 OPPORTUNITIES (sorted by profit):\n`);
            this.opportunities
                .sort((a, b) => parseFloat(b.netBp) - parseFloat(a.netBp))
                .forEach((opp, i) => {
                    console.log(`${i + 1}. ${opp.pair.padEnd(20)} | ${opp.netBp} bp | $${opp.profitPer100k}/100k | BUY: ${opp.buyDex} → SELL: ${opp.sellDex}`);
                });
            console.log();
        }

        return this.opportunities;
    }
}

module.exports = ThreeWayScanner;
