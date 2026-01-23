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

/**
 * Factory Addresses for Base Mainnet (2026 Updated)
 * Using .toLowerCase() before getAddress ensures EIP-55 validation passes 
 * and prevents "bad address checksum" errors.
 */
const FACTORIES = {
    UNISWAP_V2: { 
        address: ethers.utils.getAddress("0x8909dc15e40173ff4699343b6eb8132c65e18ec6".toLowerCase()), 
        abi: UNISWAP_V2_FACTORY_ABI, 
        type: "v2" 
    },
    UNISWAP_V3: { 
        address: ethers.utils.getAddress("0x33128a8fc17869897dce68ed026d694621f6fdfd".toLowerCase()), 
        abi: UNISWAP_V3_FACTORY_ABI, 
        type: "v3" 
    },
    AERODROME:  { 
        address: ethers.utils.getAddress("0x420dd381b31aef6683db6b902084cb0ffece40da".toLowerCase()), 
        abi: AERODROME_FACTORY_ABI, 
        type: "aerodrome" 
    },
    PANCAKE_V3: { 
        address: ethers.utils.getAddress("0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865".toLowerCase()), 
        abi: UNISWAP_V3_FACTORY_ABI, 
        type: "v3" 
    }
};

/**
 * Dynamically finds all available pools for a token pair across all supported DEXs
 */
async function discoverAllPools(tokenA, tokenB) {
    const discoveredPools = [];
    console.log(`🔍 Searching for all pools: ${tokenA} <-> ${tokenB}`);

    // Standardize token addresses to avoid checksum errors here too
    const addrA = ethers.utils.getAddress(tokenA.toLowerCase());
    const addrB = ethers.utils.getAddress(tokenB.toLowerCase());

    for (const [name, factory] of Object.entries(FACTORIES)) {
        const contract = new ethers.Contract(factory.address, factory.abi, provider);
        
        try {
            if (factory.type === "v2") {
                const poolAddress = await withRetry(() => contract.getPair(addrA, addrB));
                if (poolAddress !== ethers.constants.AddressZero) {
                    discoveredPools.push({ dex: name, address: poolAddress, type: "v2" });
                }
            } else if (factory.type === "v3") {
                // Common V3 fee tiers: 0.01%, 0.05%, 0.3%, 1%
                const fees = [100, 500, 3000, 10000];
                for (const fee of fees) {
                    const poolAddress = await withRetry(() => contract.getPool(addrA, addrB, fee));
                    if (poolAddress !== ethers.constants.AddressZero) {
                        discoveredPools.push({ dex: name, address: poolAddress, type: "v3", fee });
                    }
                    // Small delay to prevent hitting free-tier RPC limits too hard
                    await new Promise(r => setTimeout(r, 100)); 
                }
            } else if (factory.type === "aerodrome") {
                // Aerodrome uses 'stable' boolean for pool types
                for (const stable of [true, false]) {
                    const poolAddress = await contract.getPool(addrA, addrB, stable);
                    if (poolAddress !== ethers.constants.AddressZero) {
                        discoveredPools.push({ dex: name, address: poolAddress, type: "aerodrome", stable });
                    }
                }
            }
        } catch (e) {
            console.error(`⚠️ Error searching ${name}:`, e.message);
        }
    }

    return discoveredPools;
}

module.exports = { discoverAllPools };
