require("dotenv").config();
const { ethers } = require("ethers");
const { MultiCall } = require("@indexed-finance/multicall");
const Decimal = require("decimal.js"); // ADDED: For precise price calculations

// RPC for Base Mainnet
const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

// Correctly initialize MultiCall instance
const multi = new MultiCall(provider);

// --- FACTORY ADDRESSES (Checksummed) ---
const UNI_FACTORY = ethers.utils.getAddress("0x1F98431c8aD98523631AE4a59f267346ea31F984");
const PANCAKE_FACTORY = ethers.utils.getAddress("0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865");
// CRITICAL FIX: The correct, checksummed Aerodrome Slipstream (V3) Factory address
const AERO_SLIPSTREAM_FACTORY = ethers.utils.getAddress("0x4200000000000000000000000000000000000015");

// --- ABIs ---
const FACTORY_ABI = ["function getPool(address a, address b, uint24 f) view returns (address)"];
const V3_POOL_ABI = [
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function liquidity() view returns (uint128)"
];

// --- TOKENS CONFIG (Checksummed) ---
const TOKENS = {
    WETH: { addr: ethers.utils.getAddress("0x4200000000000000000000000000000000000006"), decimals: 18 },
    USDC: { addr: ethers.utils.getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54b1a51ce3"), decimals: 6 },
    CBETH: { addr: ethers.utils.getAddress("0x2ae3f1ec7f1f5012cfeab0185f7005012d3397c9"), decimals: 18 }
};

// IMPROVED: Handle Decimal Differences for accurate pricing using decimal.js
function calculatePrice(sqrtPriceX96, dec0, dec1) {
    const sqrtPrice = new Decimal(sqrtPriceX96.toString());
    const priceNumerator = sqrtPrice.pow(2).mul(new Decimal(10).pow(dec0));
    const priceDenominator = new Decimal(2).pow(192).mul(new Decimal(10).pow(dec1));
    return priceNumerator.div(priceDenominator).toNumber();
}

async function detectArb() {
    console.log(`[${new Date().toISOString()}] Scanning Base for opportunities...`);
    
    const poolQueries = [];
    const tokenPairs = [
        [TOKENS.WETH, TOKENS.USDC],
        [TOKENS.CBETH, TOKENS.WETH]
    ];

    // 1. Prepare Pool Address Queries
    for (const [t0, t1] of tokenPairs) {
        // IMPROVED: Robust sorting by comparing lowercase strings
        const [tokenA, tokenB] = t0.addr.toLowerCase() < t1.addr.toLowerCase()
            ? [t0.addr, t1.addr]
            : [t1.addr, t0.addr];

        [500, 3000].forEach(fee => {
            poolQueries.push({ target: UNI_FACTORY, method: 'getPool', args: [tokenA, tokenB, fee], meta: { dex: 'UniV3', t0, t1 } });
            poolQueries.push({ target: PANCAKE_FACTORY, method: 'getPool', args: [tokenA, tokenB, fee], meta: { dex: 'PancakeV3', t0, t1 } });
            poolQueries.push({ target: AERO_SLIPSTREAM_FACTORY, method: 'getPool', args: [tokenA, tokenB, fee], meta: { dex: 'Aerodrome', t0, t1 } });
        });
    }

    const poolAddressCalls = poolQueries.map(q => ({
        target: q.target,
        function: q.method,
        args: q.args,
        interface: new ethers.utils.Interface(FACTORY_ABI)
    }));
    
    let poolAddresses;
    try {
        poolAddresses = await multi.multiCall(poolAddressCalls);
    } catch (error) {
        console.error("[Error] Failed to fetch pool addresses:", error.message);
        return;
    }
    
    // 2. Prepare Pool State Queries
    const stateQueries = [];
    poolAddresses.forEach((addr, i) => {
        // CRITICAL FIX: Add a check to ensure 'addr' is a valid string before using it
        if (typeof addr === 'string' && addr.startsWith('0x') && addr !== ethers.constants.AddressZero) {
            stateQueries.push({ target: addr, method: 'slot0', meta: { ...poolQueries[i].meta, addr } });
            stateQueries.push({ target: addr, method: 'liquidity', meta: { ...poolQueries[i].meta, addr } });
        } else {
            // This log will help you see if the RPC is returning bad data
            console.log(`[Info] Skipping invalid or non-existent pool. Query: ${poolQueries[i].meta.dex} ${poolQueries[i].meta.t0.addr.slice(0,6)}/${poolQueries[i].meta.t1.addr.slice(0,6)}. Result: ${addr}`);
        }
    });

    if (stateQueries.length === 0) {
        console.log("[Info] No active pools found to check.");
        return;
    }

    const stateCalls = stateQueries.map(q => ({
        target: q.target,
        function: q.method,
        interface: new ethers.utils.Interface(V3_POOL_ABI)
    }));

    const states = await multi.multiCall(stateCalls);

    const activePools = [];
    for (let i = 0; i < states.length; i += 2) {
        const slot0 = states[i];
        const liquidity = states[i+1];
        const meta = stateQueries[i].meta;

        // Check liquidity using .gt(0) from BigNumber
        if (liquidity && ethers.BigNumber.from(liquidity).gt(0)) {
            const price = calculatePrice(slot0.sqrtPriceX96.toString(), meta.t0.decimals, meta.t1.decimals);
            activePools.push({ ...meta, price });
        }
    }

    // 3. Compare Prices
    if (activePools.length === 0) {
        console.log("[Info] No pools with liquidity found.");
        return;
    }

    for (let i = 0; i < activePools.length; i++) {
        for (let j = i + 1; j < activePools.length; j++) {
            const p1 = activePools[i];
            const p2 = activePools[j];

            if (p1.t0.addr === p2.t0.addr && p1.t1.addr === p2.t1.addr) {
                const diff = ((p1.price - p2.price) / p2.price) * 100;
                if (Math.abs(diff) > 0.5) {
                    console.log(`[Arb] ${diff.toFixed(3)}% spread between ${p1.dex} (${p1.price.toFixed(4)}) and ${p2.dex} (${p2.price.toFixed(4)}) for ${p1.t0.addr.slice(0,6)}.../${p1.t1.addr.slice(0,6)}...`);
                    // Trigger execution logic here
                }
            }
        }
    }
}

// Add a global handler for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Fatal] Unhandled Rejection at:', promise, 'reason:', reason);
});

setInterval(async () => {
    try { 
        await detectArb(); 
    } catch (e) { 
        console.error("[Detection Error]:", e.message); 
    }
}, 10000);
