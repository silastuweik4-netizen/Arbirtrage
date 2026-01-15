const { ethers } = require('ethers');

// --- CONFIGURATION ---
const RPC_URL = process.env.BASE_RPC_URL || 'base-mainnet.g.alchemy.com';

// Configure provider statically to prevent "failed to detect network" errors
const provider = new ethers.JsonRpcProvider(RPC_URL, {
    chainId: 8453,
    name: 'base'
}, { staticNetwork: true });

const TOKENS = {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDbC: "0xd9aAEc86B65D86f6A7B630E2C953757eFB0d5E88"
};

const QUOTERS = {
    AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0", 
    PANCAKESWAP: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" 
};

const QUOTER_ABI = [
    "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

// FIXED: Added the missing fee values here
const FEE_TIERS = [100, 500, 2500, 3000, 10000]; 

class ArbitrageScanner {
  constructor() {
    this.aeroQuoter = null;
    this.pancakeQuoter = null;
  }

  async initialize() {
    this.aeroQuoter = new ethers.Contract(QUOTERS.AERODROME, QUOTER_ABI, provider);
    this.pancakeQuoter = new ethers.Contract(QUOTERS.PANCAKESWAP, QUOTER_ABI, provider);
    try {
        const block = await provider.getBlockNumber();
        console.log(`✅ Connected to Base. Current Block: ${block}`);
    } catch (e) {
        console.error("Connection failed. Check RPC URL.");
    }
  }

  async getQuote(contract, tokenIn, tokenOut, fee, amount) {
    try {
      return await contract.quoteExactInputSingle.staticCall(
        tokenIn, tokenOut, fee, amount, 0
      );
    } catch (e) {
      return 0n;
    }
  }

  async scanForArbitrageOpportunities() {
    const opportunities = [];
    const amountIn = ethers.parseEther("1"); 
    const tokenIn = TOKENS.WETH;
    const tokenOut = TOKENS.USDC;

    let bestAero = 0n;
    let bestPancake = 0n;

    for (const fee of FEE_TIERS) {
        const [aQuote, pQuote] = await Promise.all([
            this.getQuote(this.aeroQuoter, tokenIn, tokenOut, fee, amountIn),
            this.getQuote(this.pancakeQuoter, tokenIn, tokenOut, fee, amountIn)
        ]);
        
        if (aQuote > bestAero) bestAero = aQuote;
        if (pQuote > bestPancake) bestPancake = pQuote;
    }

    if (bestAero > 0n && bestPancake > 0n) {
        const diff = bestAero > bestPancake ? bestAero - bestPancake : bestPancake - bestAero;
        const percentage = (Number(diff) / Number(bestPancake)) * 100;
        
        if (percentage > 0.05) { 
            opportunities.push({
                pair: "WETH/USDC",
                spreadPercent: percentage.toFixed(4),
                priceAero: ethers.formatUnits(bestAero, 6),
                pricePancake: ethers.formatUnits(bestPancake, 6),
                timestamp: new Date().toISOString()
            });
        }
    }
    return opportunities;
  }

  async getTokenInfo(address) {
    try {
        const tokenContract = new ethers.Contract(address, [
            "function name() view returns (string)",
            "function symbol() view returns (string)",
            "function decimals() view returns (uint8)"
        ], provider);
        const [name, symbol, decimals] = await Promise.all([
            tokenContract.name(),
            tokenContract.symbol(),
            tokenContract.decimals()
        ]);
        return { address, name, symbol, decimals };
    } catch (e) {
        throw new Error("Invalid token address or network error");
    }
  }
}

module.exports = ArbitrageScanner;
