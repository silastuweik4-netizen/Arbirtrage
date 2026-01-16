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
    PYUSD: "0x735659E05da55609e9f906059d4860D49845F549"
};

const QUOTERS = {
    AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
    PANCAKESWAP: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997"
};

const QUOTER_ABI = [
    "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
];

// Verified 2026 Tiers for Base DEXs
const FEE_TIERS =;

class ArbitrageScanner {
    constructor() {
        this.aero = new ethers.Contract(QUOTERS.AERODROME, QUOTER_ABI, provider);
        this.pancake = new ethers.Contract(QUOTERS.PANCAKESWAP, QUOTER_ABI, provider);
    }

    async initialize() {
        try {
            const block = await provider.getBlockNumber();
            console.log(`✅ [2026-01-16] Scanner Active. Block: ${block}`);
        } catch (e) { console.error("❌ Connection failed."); }
    }

    async getQuote(dex, tokenIn, tokenOut, fee, amountInScaled) {
        try {
            if (dex === 'PANCAKE') {
                const params = { tokenIn, tokenOut, amountIn: amountInScaled, fee, sqrtPriceLimitX96: 0 };
                return (await this.pancake.quoteExactInputSingle.staticCall(params)).amountOut;
            } else {
                const path = ethers.solidityPacked(['address', 'uint24', 'address'], [tokenIn, fee, tokenOut]);
                return (await this.aero.quoteExactInput.staticCall(path, amountInScaled)).amountOut;
            }
        } catch (e) { return 0n; }
    }

    async scanForArbitrageOpportunities() {
        const opportunities = [];
        const pairsToScan = [
            { name: "WETH/USDC", in: TOKENS.WETH, out: TOKENS.USDC, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 6 },
            { name: "cbBTC/USDC", in: TOKENS.cbBTC, out: TOKENS.USDC, amountInScaled: ethers.parseUnits("1.0", 8), decOut: 6 },
            { name: "cbETH/WETH", in: TOKENS.cbETH, out: TOKENS.WETH, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 18 },
            { name: "AERO/USDC", in: TOKENS.AERO, out: TOKENS.USDC, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 6 },
            { name: "VIRTUAL/WETH", in: TOKENS.VIRTUAL, out: TOKENS.WETH, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 18 },
            { name: "USDbC/USDC", in: TOKENS.USDbC, out: TOKENS.USDC, amountInScaled: ethers.parseUnits("1.0", 6), decOut: 6 },
            { name: "DEGEN/WETH", in: TOKENS.DEGEN, out: TOKENS.WETH, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 18 },
            { name: "LINK/USDC", in: TOKENS.LINK, out: TOKENS.USDC, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 6 },
            { name: "PYUSD/USDC", in: TOKENS.PYUSD, out: TOKENS.USDC, amountInScaled: ethers.parseUnits("1.0", 6), decOut: 6 },
            { name: "WETH/USDbC", in: TOKENS.WETH, out: TOKENS.USDbC, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 6 },
            { name: "cbBTC/WETH", in: TOKENS.cbBTC, out: TOKENS.WETH, amountInScaled: ethers.parseUnits("1.0", 8), decOut: 18 },
            { name: "AERO/WETH", in: TOKENS.AERO, out: TOKENS.WETH, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 18 },
            { name: "VIRTUAL/USDC", in: TOKENS.VIRTUAL, out: TOKENS.USDC, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 6 },
            { name: "DEGEN/USDC", in: TOKENS.DEGEN, out: TOKENS.USDC, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 6 },
            { name: "LINK/WETH", in: TOKENS.LINK, out: TOKENS.WETH, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 18 },
            { name: "WETH/cbBTC", in: TOKENS.WETH, out: TOKENS.cbBTC, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 8 },
            { name: "USDC/USDbC", in: TOKENS.USDC, out: TOKENS.USDbC, amountInScaled: ethers.parseUnits("1.0", 6), decOut: 6 },
            { name: "WETH/DEGEN", in: TOKENS.WETH, out: TOKENS.DEGEN, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 18 },
            { name: "WETH/cbETH", in: TOKENS.WETH, out: TOKENS.cbETH, amountInScaled: ethers.parseUnits("1.0", 18), decOut: 18 },
            { name: "cbBTC/cbETH", in: TOKENS.cbBTC, out: TOKENS.cbETH, amountInScaled: ethers.parseUnits("1.0", 8), decOut: 18 }
        ];

        console.log(`\n🔍 [2026-01-16] Scanning ${pairsToScan.length} pairs...`);

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
                if (spread >= 0.01) opportunities.push({ pair: pair.name, spreadPercent: spread.toFixed(4) });
            }
        }
        return opportunities;
    }
}

module.exports = ArbitrageScanner;
