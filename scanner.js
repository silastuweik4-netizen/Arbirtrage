const { ethers } = require('ethers');

// --- CONFIGURATION ---
const RPC_URL = process.env.BASE_RPC_URL || 'base-mainnet.g.alchemy.com';

const provider = new ethers.JsonRpcProvider(RPC_URL, {
    chainId: 8453,
    name: 'base'
}, { staticNetwork: true });

const TOKENS = {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDbC: "0xd9aAEc86B65D86f6A7B630E2C953757eFB0d5E88",
    cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    cbETH: "0x2Ae3F1eB1fC2e6d6d8D042C9D066bC06D9455358",
    AERO: "0x94018130A5798221261ea3c3211516e872707253",
    VIRTUAL: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
    LINK: "0x88fb150d797089988189c62907473c0cc2d3d3a9",
    DEGEN: "0x4ed4E1115d9e50E85617F3342551391D93F76445"
};

const QUOTERS = {
    AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
    PANCAKESWAP: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997"
};

const QUOTER_ABI = [
    "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

// FIXED: Fee tiers for Aerodrome Slipstream and PancakeSwap V3
const FEE_TIERS = [100, 500, 2500, 3000, 10000];

class ArbitrageScanner {
  constructor() {
    this.aeroQuoter = new ethers.Contract(QUOTERS.AERODROME, QUOTER_ABI, provider);
    this.pancakeQuoter = new ethers.Contract(QUOTERS.PANCAKESWAP, QUOTER_ABI, provider);
  }

  async initialize() {
    try {
        const block = await provider.getBlockNumber();
        console.log(`✅ [2026-01-15] Linked to Base Mainnet. Block: ${block}`);
    } catch (e) {
        console.error("❌ Connection failed. Check RPC URL.");
    }
  }

  async getQuote(contract, tokenIn, tokenOut, fee, amount) {
    try {
      return await contract.quoteExactInputSingle.staticCall(tokenIn, tokenOut, fee, amount, 0);
    } catch (e) {
      return 0n;
    }
  }

  async scanForArbitrageOpportunities() {
    const opportunities = [];
    const amountIn = ethers.parseEther("1"); 
    
    const pairsToScan = [
        { name: "WETH/USDC", in: TOKENS.WETH, out: TOKENS.USDC, decOut: 6 },
        { name: "WETH/USDbC", in: TOKENS.WETH, out: TOKENS.USDbC, decOut: 6 },
        { name: "cbBTC/USDC", in: TOKENS.cbBTC, out: TOKENS.USDC, decOut: 6 },
        { name: "cbETH/WETH", in: TOKENS.cbETH, out: TOKENS.WETH, decOut: 18 },
        { name: "AERO/USDC", in: TOKENS.AERO, out: TOKENS.USDC, decOut: 6 },
        { name: "VIRTUAL/WETH", in: TOKENS.VIRTUAL, out: TOKENS.WETH, decOut: 18 },
        { name: "LINK/USDC", in: TOKENS.LINK, out: TOKENS.USDC, decOut: 6 },
        { name: "DEGEN/WETH", in: TOKENS.DEGEN, out: TOKENS.WETH, decOut: 18 },
        { name: "WETH/cbBTC", in: TOKENS.WETH, out: TOKENS.cbBTC, decOut: 8 },
        { name: "USDC/USDbC", in: TOKENS.USDC, out: TOKENS.USDbC, decOut: 6 },
        { name: "AERO/WETH", in: TOKENS.AERO, out: TOKENS.WETH, decOut: 18 },
        { name: "VIRTUAL/USDC", in: TOKENS.VIRTUAL, out: TOKENS.USDC, decOut: 6 },
        { name: "cbBTC/WETH", in: TOKENS.cbBTC, out: TOKENS.WETH, decOut: 18 },
        { name: "cbETH/USDC", in: TOKENS.cbETH, out: TOKENS.USDC, decOut: 6 },
        { name: "DEGEN/USDC", in: TOKENS.DEGEN, out: TOKENS.USDC, decOut: 6 },
        { name: "LINK/WETH", in: TOKENS.LINK, out: TOKENS.WETH, decOut: 18 },
        { name: "USDbC/USDC", in: TOKENS.USDbC, out: TOKENS.USDC, decOut: 6 },
        { name: "WETH/AERO", in: TOKENS.WETH, out: TOKENS.AERO, decOut: 18 },
        { name: "WETH/VIRTUAL", in: TOKENS.WETH, out: TOKENS.VIRTUAL, decOut: 18 },
        { name: "cbBTC/cbETH", in: TOKENS.cbBTC, out: TOKENS.cbETH, decOut: 18 }
    ];

    console.log(`\n🔍 [SCAN START] Checking ${pairsToScan.length} pairs...`);

    for (const pair of pairsToScan) {
        let bestAero = 0n;
        let bestPancake = 0n;

        for (const fee of FEE_TIERS) {
            const [aQ, pQ] = await Promise.all([
                this.getQuote(this.aeroQuoter, pair.in, pair.out, fee, amountIn),
                this.getQuote(this.pancakeQuoter, pair.in, pair.out, fee, amountIn)
            ]);
            if (aQ > bestAero) bestAero = aQ;
            if (pQ > bestPancake) bestPancake = pQ;
        }

        if (bestAero > 0n || bestPancake > 0n) {
            const aeroPrice = bestAero > 0n ? ethers.formatUnits(bestAero, pair.decOut) : "No Pool";
            const pancakePrice = bestPancake > 0n ? ethers.formatUnits(bestPancake, pair.decOut) : "No Pool";
            
            // VERIFICATION LOGS
            console.log(`Pair: ${pair.name.padEnd(13)} | Aero: ${aeroPrice.padEnd(12)} | Pancake: ${pancakePrice.padEnd(12)}`);

            if (bestAero > 0n && bestPancake > 0n) {
                const diff = bestAero > bestPancake ? bestAero - bestPancake : bestPancake - bestAero;
                const percentage = (Number(diff) / Number(bestPancake)) * 100;
                
                if (percentage >= 0.01) { // 0.01% threshold
                    opportunities.push({
                        pair: pair.name,
                        spreadPercent: percentage.toFixed(4),
                        priceAero: aeroPrice,
                        pricePancake: pancakePrice,
                        timestamp: new Date().toISOString()
                    });
                }
            }
        }
    }
    console.log(`📊 [SCAN COMPLETE] Found ${opportunities.length} opportunities.\n`);
    return opportunities;
  }

  async getTokenInfo(address) {
    const token = new ethers.Contract(address, [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)"
    ], provider);
    const [name, symbol, decimals] = await Promise.all([token.name(), token.symbol(), token.decimals()]);
    return { address, name, symbol, decimals };
  }
}

module.exports = ArbitrageScanner;
