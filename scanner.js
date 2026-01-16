const { ethers } = require('ethers');

// --- 2026 CONFIGURATION ---
const RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com';
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 8453, name: 'base' }, { staticNetwork: true });

const TOKENS = {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    AERO: "0x94018130A5798221261ea3c3211516e872707253",
    VIRTUAL: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b"
};

const QUOTERS = {
    AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
    PANCAKESWAP: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997"
};

const QUOTER_ABI = [
    "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
];

// FIXED: Manually populated fee tiers to prevent SyntaxError
const FEE_TIERS =; 

class ArbitrageScanner {
    constructor() {
        this.aero = new ethers.Contract(QUOTERS.AERODROME, QUOTER_ABI, provider);
        this.pancake = new ethers.Contract(QUOTERS.PANCAKESWAP, QUOTER_ABI, provider);
    }

    async initialize() {
        const block = await provider.getBlockNumber();
        console.log(`✅ [CORE] Scanner Active on Base. Block: ${block}`);
    }

    async getQuote(dex, tokenIn, tokenOut, fee, amount) {
        try {
            if (dex === 'PANCAKE') {
                const params = { tokenIn, tokenOut, amountIn: amount, fee, sqrtPriceLimitX96: 0 };
                const result = await this.pancake.quoteExactInputSingle.staticCall(params);
                return result.amountOut;
            } else {
                // Aerodrome Slipstream requires a packed path
                const path = ethers.solidityPacked(['address', 'uint24', 'address'], [tokenIn, fee, tokenOut]);
                const result = await this.aero.quoteExactInput.staticCall(path, amount);
                return result.amountOut;
            }
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
            { name: "AERO/USDC", in: TOKENS.AERO, out: TOKENS.USDC, dec: 6 },
            { name: "VIRTUAL/WETH", in: TOKENS.VIRTUAL, out: TOKENS.WETH, dec: 18 }
        ];

        console.log(`\n🔍 [2026 SCAN] Checking ${pairs.length} high-liquidity pairs...`);

        for (const pair of pairs) {
            let bestAero = 0n, bestPancake = 0n;

            for (const fee of FEE_TIERS) {
                const [aQ, pQ] = await Promise.all([
                    this.getQuote('AERO', pair.in, pair.out, fee, amountIn),
                    this.getQuote('PANCAKE', pair.in, pair.out, fee, amountIn)
                ]);
                if (aQ > bestAero) bestAero = aQ;
                if (pQ > bestPancake) bestPancake = pQ;
            }

            const pA = bestAero > 0n ? ethers.formatUnits(bestAero, pair.dec) : "N/A";
            const pP = bestPancake > 0n ? ethers.formatUnits(bestPancake, pair.dec) : "N/A";
            
            console.log(`${pair.name.padEnd(12)} | Aero: ${pA.padEnd(10)} | Pancake: ${pP.padEnd(10)}`);

            if (bestAero > 0n && bestPancake > 0n) {
                const diff = bestAero > bestPancake ? bestAero - bestPancake : bestPancake - bestAero;
                const spread = (Number(diff) / Number(bestPancake)) * 100;
                if (spread >= 0.01) {
                    opportunities.push({ pair: pair.name, spread: spread.toFixed(4), aero: pA, pancake: pP });
                }
            }
        }
        return opportunities;
    }

    async getTokenInfo(address) {
        const token = new ethers.Contract(address, ["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"], provider);
        const [name, symbol, decimals] = await Promise.all([token.name(), token.symbol(), token.decimals()]);
        return { address, name, symbol, decimals };
    }
}

module.exports = ArbitrageScanner;
