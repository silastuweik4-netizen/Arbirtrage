// pool_discovery.js
const { ethers } = require("ethers");
require("dotenv").config();

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
// Use StaticJsonRpcProvider for better performance with Alchemy
const provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL);

/**
 * Helper to handle Alchemy rate limits with exponential backoff
 */
async function withRetry(fn, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            if (e.message.includes("429") || e.message.includes("rate limit")) {
                console.log(`⚠️ Rate limited. Retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                delay *= 2;
            } else {
                throw e;
            }
        }
    }
}

// Factory ABIs to find pools
const UNISWAP_V2_FACTORY_ABI = ["function getPair(address,address) external view returns (address)"];
const UNISWAP_V3_FACTORY_ABI = ["function getPool(address,address,uint24) external view returns (address)"];
const AERODROME_FACTORY_ABI = ["function getPool(address,address,bool) external view returns (address)"];

const FACTORIES = {
    UNISWAP_V2: { address: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6", abi: UNISWAP_V2_FACTORY_ABI, type: "v2" },
    UNISWAP_V3: { address: "0x33128a8fC170d030b747a24199D40Ac626aBe82F", abi: UNISWAP_V3_FACTORY_ABI, type: "v3" },
    AERODROME:  { address: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da", abi: AERODROME_FACTORY_ABI, type: "aerodrome" },
    PANCAKE_V3: { address: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865", abi: UNISWAP_V3_FACTORY_ABI, type: "v3" }
};

/**
 * Dynamically finds all available pools for a token pair across all supported DEXs
 */
async function discoverAllPools(tokenA, tokenB) {
    const discoveredPools = [];
    console.log(`🔍 Searching for all pools: ${tokenA} <-> ${tokenB}`);

    for (const [name, factory] of Object.entries(FACTORIES)) {
        const contract = new ethers.Contract(factory.address, factory.abi, provider);
        
        try {
            if (factory.type === "v2") {
                const poolAddress = await withRetry(() => contract.getPair(tokenA, tokenB));
                if (poolAddress !== ethers.constants.AddressZero) {
                    discoveredPools.push({ dex: name, address: poolAddress, type: "v2" });
                }
            } else if (factory.type === "v3") {
                const fees = [100, 500, 3000, 10000];
                for (const fee of fees) {
                    const poolAddress = await withRetry(() => contract.getPool(tokenA, tokenB, fee));
                    if (poolAddress !== ethers.constants.AddressZero) {
                        discoveredPools.push({ dex: name, address: poolAddress, type: "v3", fee });
                    }
                    await new Promise(r => setTimeout(r, 200)); // Increased delay for Alchemy free tier
                }
            } else if (factory.type === "aerodrome") {
                // Check both Stable and Volatile
                for (const stable of [true, false]) {
                    const poolAddress = await contract.getPool(tokenA, tokenB, stable);
                    if (poolAddress !== ethers.constants.AddressZero) {
                        discoveredPools.push({ dex: name, address: poolAddress, type: "aerodrome", stable });
                    }
                }
            }
        } catch (e) {
            console.error(`Error searching ${name}:`, e.message);
        }
    }

    return discoveredPools;
}

module.exports = { discoverAllPools };
