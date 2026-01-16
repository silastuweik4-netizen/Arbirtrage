const { ethers } = require('ethers');

const RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com';
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 8453, name: 'base' }, { staticNetwork: true });

const TOKENS = {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // Verified 2026
    VIRTUAL: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
    AERO: "0x94018130A5798221261ea3c3211516e872707253"
};

const QUOTERS = {
    AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
    PANCAKESWAP: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997"
};

const QUOTER_ABI = ["function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"];
const FEE_TIERS = [100, 500, 2500, 3000, 10000];

class ArbitrageScanner {
    constructor() {
        this.aeroQuoter = new ethers.Contract(QUOTERS.AERODROME, QUOTER_ABI, provider);
        this.pancakeQuoter = new ethers.Contract(QUOTERS.PANCAKESWAP, QUOTER_ABI, provider);
    }

    async initialize() {
        const block = await provider.getBlockNumber();
        console.log(`✅ [2026-01-16] Connected to Base. Block: ${block}`);
    }

    async getQuote(contract, tokenIn, tokenOut, fee, amount) {
        try { return await contract.quoteExactInputSingle.staticCall(tokenIn, tokenOut, fee, amount, 0); }
        catch (e) { return 0n; }
    }

    async scanForArbitrageOpportunities() {
        const opportunities = [];
        const amountIn = ethers.parseEther("1");
        const pairsToScan = [
            { name: "WETH/USDC", in: TOKENS.WETH, out: TOKENS.USDC, decOut: 6 },
            { name: "cbBTC/USDC", in: TOKENS.cbBTC, out: TOKENS.USDC, decOut: 6 },
            { name: "VIRTUAL/WETH", in: TOKENS.VIRTUAL, out: TOKENS.WETH, decOut: 18 },
            { name: "AERO/USDC", in: TOKENS.AERO, out: TOKENS.USDC, decOut: 6 }
            // Add up to 20 pairs here following the same format
        ];

        console.log(`\n🔍 [SCAN START] - ${new Date().toISOString()}`);

        for (const pair of pairsToScan) {
            let bestAero = 0n, bestPancake = 0n;
            for (const fee of FEE_TIERS) {
                const [aQ, pQ] = await Promise.all([
                    this.getQuote(this.aeroQuoter, pair.in, pair.out, fee, amountIn),
                    this.getQuote(this.pancakeQuoter, pair.in, pair.out, fee, amountIn)
                ]);
                if (aQ > bestAero) bestAero = aQ;
                if (pQ > bestPancake) bestPancake = pQ;
            }

            const aeroPrice = bestAero > 0n ? ethers.formatUnits(bestAero, pair.decOut) : "No Pool";
            const pancakePrice = bestPancake > 0n ? ethers.formatUnits(bestPancake, pair.decOut) : "No Pool";
            
            // This is the logging you requested to see in your Render console:
            console.log(`Pair: ${pair.name.padEnd(12)} | Aero: ${aeroPrice.padEnd(12)} | Pancake: ${pancakePrice.padEnd(12)}`);

            if (bestAero > 0n && bestPancake > 0n) {
                const diff = bestAero > bestPancake ? bestAero - bestPancake : bestPancake - bestAero;
                const percentage = (Number(diff) / Number(bestPancake)) * 100;
                if (percentage >= 0.01) {
                    opportunities.push({ pair: pair.name, spread: percentage.toFixed(4) });
                }
            }
        }
        console.log(`📊 [SCAN COMPLETE] Found ${opportunities.length} opportunities.\n`);
        return opportunities;
    }
}

module.exports = ArbitrageScanner;
