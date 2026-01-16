const { ethers } = require('ethers');

// --- 2026 CONFIGURATION ---
const RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com';
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 8453, name: 'base' }, { staticNetwork: true });

const TOKENS = {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Native USDC
    cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // Coinbase BTC
    AERO: "0x94018130A5798221261ea3c3211516e872707253", // Aerodrome Finance
    VIRTUAL: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b"
};

const QUOTERS = {
    AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
    PANCAKESWAP: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997"
};

// 2026 QuoterV2 ABI - Fixed for Slipstream and Pancake V3 compatibility
const QUOTER_ABI = [
    "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
];

const FEE_TIERS = ; 

class ArbitrageScanner {
    constructor() {
        this.aero = new ethers.Contract(QUOTERS.AERODROME, QUOTER_ABI, provider);
        this.pancake = new ethers.Contract(QUOTERS.PANCAKESWAP, QUOTER_ABI, provider);
    }

    async initialize() {
        const block = await provider.getBlockNumber();
        console.log(`✅ [2026-01-16] Bot Active. Current Block: ${block}`);
    }

    async getQuote(contract, tokenIn, tokenOut, fee, amount) {
        try {
            // Updated for QuoterV2 struct parameters
            const params = {
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountIn: amount,
                fee: fee,
                sqrtPriceLimitX96: 0
            };
            const result = await contract.quoteExactInputSingle.staticCall(params);
            return result.amountOut;
        } catch (e) {
            return 0n;
        }
    }

    async scanForArbitrageOpportunities() {
        const opportunities = [];
        const amountIn = ethers.parseEther("1");
        const pairs = [
            { name: "WETH/USDC", in: TOKENS.WETH, out: TOKENS.USDC, dec: 6 },
            { name: "cbBTC/USDC", in: TOKENS.cbBTC, out: TOKENS.USDC, dec: 6 },
            { name: "VIRTUAL/WETH", in: TOKENS.VIRTUAL, out: TOKENS.WETH, dec: 18 },
            { name: "AERO/USDC", in: TOKENS.AERO, out: TOKENS.USDC, dec: 6 }
        ];

        console.log(`\n🔍 [LIVE SCAN] - ${new Date().toISOString()}`);

        for (const pair of pairs) {
            let bestAero = 0n, bestPancake = 0n;
            for (const fee of FEE_TIERS) {
                const [aQ, pQ] = await Promise.all([
                    this.getQuote(this.aero, pair.in, pair.out, fee, amountIn),
                    this.getQuote(this.pancake, pair.in, pair.out, fee, amountIn)
                ]);
                if (aQ > bestAero) bestAero = aQ;
                if (pQ > bestPancake) bestPancake = pQ;
            }

            const p1 = bestAero > 0n ? ethers.formatUnits(bestAero, pair.dec) : "N/A";
            const p2 = bestPancake > 0n ? ethers.formatUnits(bestPancake, pair.dec) : "N/A";
            
            console.log(`${pair.name.padEnd(12)} | Aero: ${p1.padEnd(10)} | Pancake: ${p2.padEnd(10)}`);

            if (bestAero > 0n && bestPancake > 0n) {
                const diff = bestAero > bestPancake ? bestAero - bestPancake : bestPancake - bestAero;
                const spread = (Number(diff) / Number(bestPancake)) * 100;
                if (spread >= 0.01) {
                    opportunities.push({ pair: pair.name, spread: spread.toFixed(4) });
                }
            }
        }
        return opportunities;
    }
}

module.exports = ArbitrageScanner;
