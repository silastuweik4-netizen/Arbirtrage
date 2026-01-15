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
    USDbC: "0xd9aAEc86B65D86f6A7B630e2c953757eFB0d5E88"
};

const QUOTERS = {
    AERODROME: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0", // Verified Quoter
    PANCAKESWAP: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" // Verified QuoterV2
};

const QUOTER_ABI = [
    "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

const FEE_TIERS = ; // Common V3 fees in basis points

// --- SCANNER CLASS ---

class ArbitrageScanner {
  constructor() {
    this.aeroQuoter = null;
    this.pancakeQuoter = null;
    console.log(`Scanner instance created.`);
  }

  // Used by server.js initializeScanner()
  async initialize() {
    // We already configured the provider statically, no need for async network detection
    this.aeroQuoter = new ethers.Contract(QUOTERS.AERODROME, QUOTER_ABI, provider);
    this.pancakeQuoter = new ethers.Contract(QUOTERS.PANCAKESWAP, QUOTER_ABI, provider);
    console.log(`Connected to Base @ block ${await provider.getBlockNumber()}`);
  }

  async getQuote(contract, tokenIn, tokenOut, fee, amount) {
    try {
      // Use .staticCall to perform a read-only call that handles contract reverts gracefully
      const amountOut = await contract.quoteExactInputSingle.staticCall(
        tokenIn, tokenOut, fee, amount, 0
      );
      return amountOut;
    } catch (e) {
      // Return 0 if the specific pool/fee tier does not exist
      return 0n;
    }
  }

  // Used by server.js scan endpoint
  async scanForArbitrageOpportunities() {
    const opportunities = [];
    const amountIn = ethers.parseEther("1"); // Use 1 WETH as standard input

    console.log('[SCANNER] Starting arbitrage scan...');

    // We only scan WETH/USDC for this example
    const tokenIn = TOKENS.WETH;
    const tokenOut = TOKENS.USDC;
    const pairName = "WETH/USDC";

    let bestAero = 0n;
    let bestPancake = 0n;

    // Iterate through all possible fees
    for (const fee of FEE_TIERS) {
        const aeroQuote = await this.getQuote(this.aeroQuoter, tokenIn, tokenOut, fee, amountIn);
        const pancakeQuote = await this.getQuote(this.pancakeQuoter, tokenIn, tokenOut, fee, amountIn);
        
        if (aeroQuote > bestAero) bestAero = aeroQuote;
        if (pancakeQuote > bestPancake) bestPancake = pancakeQuote;
    }

    if (bestAero > 0n && bestPancake > 0n) {
        const diff = bestAero > bestPancake ? bestAero - bestPancake : bestPancake - bestAero;
        const percentage = (Number(diff) / Number(bestPancake)) * 100;
        
        console.log(`[SCANNER] ${pairName} | Spread: ${percentage.toFixed(4)}%`);

        if (percentage > 0.1) { // Example threshold: 0.1%
            opportunities.push({
                pair: pairName,
                spreadPercent: percentage.toFixed(4),
                amountIn: ethers.formatEther(amountIn),
                priceAero: ethers.formatUnits(bestAero, 6),
                pricePancake: ethers.formatUnits(bestPancake, 6),
                // Simplified paths would be added here
            });
        }
    } else {
        console.log(`[SCANNER] ${pairName} - Insufficient liquidity to compare prices.`);
    }

    return opportunities;
  }

  // Used by server.js getTokenInfo endpoint (example implementation)
  async getTokenInfo(address) {
    const tokenContract = new ethers.Contract(address, [
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)"
    ], provider);

    const name = await tokenContract.name();
    const symbol = await tokenContract.symbol();
    const decimals = await tokenContract.decimals();
    
    return { address, name, symbol, decimals };
  }
}

// Export the class so server.js can use it with 'new'
module.exports = ArbitrageScanner;
