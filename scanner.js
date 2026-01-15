const { ethers } = require("ethers");

// 1. CONFIGURATION: Verified 2026 Addresses for Base Mainnet
const RPC_URL = "base-mainnet.g.alchemy.com"; // Replace with your key
const provider = new ethers.JsonRpcProvider(RPC_URL);

const DEX_CONFIG = {
    AERODROME: {
        name: "Aerodrome Slipstream",
        // Verified 2026 Quoter address for Aerodrome Slipstream on Base
        quoter: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
        fees: [100, 500, 2500, 10000] // Common fee tiers
    },
    PANCAKESWAP: {
        name: "PancakeSwap V3",
        // Official QuoterV2 for PancakeSwap on Base
        quoter: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
        fees: [100, 500, 2500, 10000]
    }
};

const TOKENS = {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDbC: "0xd9aAEc86B65D86f6A7B630E2C953757eFB0d5E88"
};

// 2. ABIs: Only the quoter logic needed
const QUOTER_ABI = [
    "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

const aeroQuoter = new ethers.Contract(DEX_CONFIG.AERODROME.quoter, QUOTER_ABI, provider);
const pancakeQuoter = new ethers.Contract(DEX_CONFIG.PANCAKESWAP.quoter, QUOTER_ABI, provider);

// 3. CORE LOGIC: Fetch Price for specific fee tier
async function getPrice(quoterContract, tokenIn, tokenOut, fee, amountIn) {
    try {
        // Use .staticCall to query without sending a transaction
        const amountOut = await quoterContract.quoteExactInputSingle.staticCall(
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            0 // No price limit
        );
        return amountOut;
    } catch (err) {
        // Normal behavior: Many fee tiers do not have a pool created
        return 0n; 
    }
}

// 4. SCANNER: Main loop
async function runScan() {
    console.log(`\n--- Starting Scan @ ${new Date().toISOString()} ---`);
    
    const amountIn = ethers.parseEther("1"); // Scan using 1 WETH
    
    // Scan pairs
    const pairs = [
        { name: "WETH/USDC", in: TOKENS.WETH, out: TOKENS.USDC },
        { name: "WETH/USDbC", in: TOKENS.WETH, out: TOKENS.USDbC }
    ];

    for (const pair of pairs) {
        let bestAero = 0n;
        let bestPancake = 0n;

        // Check all fee tiers for Aerodrome
        for (const fee of DEX_CONFIG.AERODROME.fees) {
            const quote = await getPrice(aeroQuoter, pair.in, pair.out, fee, amountIn);
            if (quote > bestAero) bestAero = quote;
        }

        // Check all fee tiers for PancakeSwap
        for (const fee of DEX_CONFIG.PANCAKESWAP.fees) {
            const quote = await getPrice(pancakeQuoter, pair.in, pair.out, fee, amountIn);
            if (quote > bestPancake) bestPancake = quote;
        }

        // Compare Results
        if (bestAero > 0n && bestPancake > 0n) {
            const diff = bestAero > bestPancake ? bestAero - bestPancake : bestPancake - bestAero;
            const percentage = (Number(diff) / Number(bestPancake)) * 100;
            
            console.log(`Pair: ${pair.name}`);
            console.log(` > Aero: ${ethers.formatUnits(bestAero, 6)} USDC`);
            console.log(` > Pancake: ${ethers.formatUnits(bestPancake, 6)} USDC`);
            console.log(` > Spread: ${percentage.toFixed(4)}%`);
        } else {
            console.log(`Pair: ${pair.name} - No liquidity found on one or both DEXes.`);
        }
    }
}

// Start
console.log("Scanner Initialized. Target: Base Mainnet");
setInterval(runScan, 10000); // Scan every 10 seconds
runScan();
