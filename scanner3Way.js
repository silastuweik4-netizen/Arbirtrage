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
        
        // Add pair configuration with token info
        this.pairConfig = new Map([
            ['WETH/USDC', { token0: '0x4200000000000000000000000000000000000006', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', inDec: 18, outDec: 6 }],
            ['WETH/USDbC', { token0: '0x4200000000000000000000000000000000000006', token1: '0xd9aAEc86B65D86f6A7B630E2C953757eFB0d5E88', inDec: 18, outDec: 6 }],
            ['cbETH/WETH', { token0: '0x2Ae3F1eB1fC2e6d6d8D042C9D066bC06D9455358', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
            ['wstETH/WETH', { token0: '0xc1CBa3fCea344f92D75dB2fe0b2564dBAccF2fbe', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
            ['WETH/DAI', { token0: '0x4200000000000000000000000000000000000006', token1: '0x50c5725949A6F0c72E6C4a641F14122319976f97', inDec: 18, outDec: 18 }],
            ['USDC/USDbC', { token0: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', token1: '0xd9aAEc86B65D86f6A7B630E2C953757eFB0d5E88', inDec: 6, outDec: 6 }],
            ['AERO/WETH', { token0: '0x940181a94A35C424E6D2d6d8313e5E8ab37be8B0', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
            ['BRETT/WETH', { token0: '0x532f06ff20bf4fb63fd4a9763cb7da19e0525405', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
            ['TOSHI/WETH', { token0: '0x6Fa0b196788CD1c8Bb99b0eFCeAf96Ddf1D96B8', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
            ['DEGEN/WETH', { token0: '0x4ed4E1115d9e50E85617F3342551391D93F76445', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
            ['CAKE/USDC', { token0: '0x0Dde4Fb1c815e2a0b3fd551da62f213c37d68c51', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', inDec: 18, outDec: 6 }],
            ['VIRTUAL/USDC', { token0: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', inDec: 18, outDec: 6 }],
            ['AIXBT/USDC', { token0: '0x4F15F73aF221cAD3D896f85AC3e3DD86D856d29B', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', inDec: 18, outDec: 6 }],
            ['cbBTC/USDC', { token0: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', inDec: 8, outDec: 6 }],
            ['CLANKER/WETH', { token0: '0x89d422e4c214e86372e7b310b76e842ff84f5e37', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
            ['USDe/USDC', { token0: '0x4c9EDD5852cd905f23a3E8b3d3335fA2Fb6c66b4', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', inDec: 18, outDec: 6 }],
            ['FLOCK/USDC', { token0: '0xe7E0a30ea6B2254cffD5fB69F0f1e74e74c10F44', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', inDec: 18, outDec: 6 }],
            ['MORPHO/WETH', { token0: '0x98878B06940aE243284CA214f2Cde41C28d9f9e0', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
            ['ODOS/WETH', { token0: '0x47ac0Fb4F2D84898b1A2dd84E0ff4e7e5535b08b', token1: '0x4200000000000000000000000000000000000006', inDec: 18, outDec: 18 }],
            ['wstETH/USDC', { token0: '0xc1CBa3fCea344f92D75dB2fe0b2564dBAccF2fbe', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', inDec: 18, outDec: 6 }],
        ]);
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
