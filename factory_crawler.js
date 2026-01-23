// factory_crawler.js
const { ethers } = require("ethers");
require("dotenv").config();

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL);

async function withRetry(fn, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            if (e.message.includes("429") || e.message.includes("rate limit")) {
                await new Promise(r => setTimeout(r, delay));
                delay *= 2;
            } else throw e;
        }
    }
}

const FACTORIES = {
    UNISWAP_V2: {
        address: ethers.utils.getAddress("0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6"),
        abi: [
            "function allPairsLength() external view returns (uint256)",
            "function allPairs(uint256) external view returns (address)",
            "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)"
        ],
        type: "v2"
    },
    AERODROME: {
        address: ethers.utils.getAddress("0x420DD381b31aEf6683db6B902084cB0FFECe40Da"),
        abi: [
            "function allPoolsLength() external view returns (uint256)",
            "function allPools(uint256) external view returns (address)",
            "event PoolCreated(address indexed token0, address indexed token1, bool stable, address pool, uint256)"
        ],
        type: "aerodrome"
    }
};

const PAIR_ABI = [
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
];

/**
 * Crawls factories to find existing pools and extract tokens
 */
async function crawlFactories(limitPerFactory = 100) {
    const discoveredTokens = new Set();
    const discoveredPools = [];

    console.log(`🕵️ Starting Factory Crawl (Limit: ${limitPerFactory} per factory)...`);

    for (const [name, config] of Object.entries(FACTORIES)) {
        try {
            const factory = new ethers.Contract(config.address, config.abi, provider);
            const length = await withRetry(() => (name === "UNISWAP_V2" ? factory.allPairsLength() : factory.allPoolsLength()));
            
            console.log(`📊 ${name} has ${length.toString()} total pools. Crawling latest ${Math.min(length, limitPerFactory)}...`);

            const start = length.gt(limitPerFactory) ? length.sub(limitPerFactory) : ethers.BigNumber.from(0);
            
            for (let i = length.toNumber() - 1; i >= start.toNumber(); i--) {
                const poolAddress = await withRetry(() => (name === "UNISWAP_V2" ? factory.allPairs(i) : factory.allPools(i)));
                const poolContract = new ethers.Contract(poolAddress, PAIR_ABI, provider);
                
                try {
                    const t0 = await withRetry(() => poolContract.token0());
                    const t1 = await withRetry(() => poolContract.token1());
                    await new Promise(r => setTimeout(r, 100)); // Delay to respect Alchemy CU limits
                    
                    discoveredTokens.add(t0.toLowerCase());
                    discoveredTokens.add(t1.toLowerCase());
                    
                    discoveredPools.push({
                        dex: name,
                        address: poolAddress,
                        token0: t0.toLowerCase(),
                        token1: t1.toLowerCase(),
                        type: config.type
                    });
                } catch (e) {
                    // Skip if not a standard pool
                }
            }
        } catch (e) {
            console.error(`❌ Error crawling ${name}:`, e.message);
        }
    }

    console.log(`✅ Crawl complete. Found ${discoveredPools.length} pools and ${discoveredTokens.size} unique tokens.`);
    return { tokens: Array.from(discoveredTokens), pools: discoveredPools };
}

module.exports = { crawlFactories, FACTORIES };
