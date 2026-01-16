const { ethers } = require('ethers');

// --- 2026 BASE MAINNET CONFIGURATION ---
const RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com';
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 8453, name: 'base' }, { staticNetwork: true });

const TOKENS = {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // 8 Decimals
    AERO: "0x94018130A5798221261ea3c3211516e872707253",
    VIRTUAL: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b"
};

const QUOTERS = {
    AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0", // Aerodrome Slipstream
    PANCAKESWAP: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" // PancakeSwap V3 QuoterV2
};

const QUOTER_ABI = [
    "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
];

// FIXED: Manually populated array with standard V3 fee tiers
const FEE_TIERS = [100, 500, 2500, 3000, 10000];

class ArbitrageScanner {
    constructor() {
        this.aero = new ethers.Contract(QUOTERS.AERODROME, QUOTER_ABI, provider);
        this.pancake = new ethers.Contract(QUOTERS.PANCAKESWAP, QUOTER_ABI, provider);
    }

    async initialize() {
        try {
            const block = await provider.getBlockNumber();
            console.log(`✅ [2026-01-16] Scanner Active. Block: ${block}`);
        } catch (e) {
            console.error("❌ Connection failed. Check RPC URL.");
        }
    }

    async getQuote(dex, tokenIn, tokenOut, fee, amountInScaled) {
        try {
            if (dex === 'PANCAKE') {
                const params = { tokenIn, tokenOut, amountIn: amountInScaled, fee, sqrtPriceLimitX96: 0 };
                const result = await this.pancake.quoteExactInputSingle.staticCall(params);
                return result.amountOut;
            } else {
                // Aerodrome Slipstream requires a packed path: [tokenIn, fee, tokenOut]
                const path = ethers.solidityPacked(['address', 'uint24', 'address'], [tokenIn, fee, tokenOut]);
                const result = await this.aero.quoteExactInput.staticCall(path, amountInScaled);
                return result.amountOut;
            }
        } catch (e) {
            return 0n;
        }
    }

    async scanForArbitrageOpportunities() {
        const opportunities = [];
        const pairsToScan = [
            { name: "WETH/USDC", in: TOKENS.WETH, out: TOKENS.USDC, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 6 },
            { name: "cbBTC/USDC", in: TOKENS.cbBTC, out: TOKENS.USDC, amountInScaled: ethers.parseUnits("1.0", 8), decOut: 6 },
            { name: "AERO/USDC", in: TOKENS.AERO, out: TOKENS.USDC, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 6 },
            { name: "VIRTUAL/WETH", in: TOKENS.VIRTUAL, out: TOKENS.WETH, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 18 }
        ];

        console.log(`\n🔍 [2026-01-16 LIVE SCAN] Checking ${pairsToScan.length} pairs...`);

        for (const pair of pairsToScan) {
            let bestAero = 0n, bestPancake = 0n;

            for (const fee of FEE_TIERS) {
                const [aQ, pQ] = await Promise.all([
                    this.getQuote('AERO', pair.in, pair.out, fee, pair.amountInScaled),
                    this.getQuote('PANCAKE', pair.in, pair.out, fee, pair.amountInScaled)
                ]);
                if (aQ > bestAero) bestAero = aQ;
                if (pQ > bestPancake) bestPancake = pQ;
            }

            const pA = bestAero > 0n ? ethers.formatUnits(bestAero, pair.decOut) : "No Pool";
            const pP = bestPancake > 0n ? ethers.formatUnits(bestPancake, pair.decOut) : "No Pool";
            
            console.log(`Pair: ${pair.name.padEnd(12)} | Aero: ${pA.padEnd(12)} | Pancake: ${pP.padEnd(12)}`);

            if (bestAero > 0n && bestPancake > 0n) {
                const diff = bestAero > bestPancake ? bestAero - bestPancake : bestPancake - bestAero;
                const spread = (Number(diff) / Number(bestPancake)) * 100;
                if (spread >= 0.01) {
                    opportunities.push({ pair: pair.name, spreadPercent: spread.toFixed(4), aeroPrice: pA, pancakePrice: pP });
                }
            }
        }
        return opportunities;
    }
}

module.exports = ArbitrageScanner;
