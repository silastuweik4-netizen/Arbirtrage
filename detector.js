require("dotenv").config();
const { ethers } = require("ethers");
const { MultiCall } = require("@indexed-finance/multicall");

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const multi = new MultiCall(provider);

// --- UPDATED ADDRESSES (Base Mainnet) ---
const UNI_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const PANCAKE_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865"; // Pancake V3 Base
const AERO_SLIPSTREAM_FACTORY = "0x5e7F9738f3f9d14029145563f4329E6a02Ae9e9f"; // Slipstream (CL)

// --- ABIs ---
const FACTORY_ABI = ["function getPool(address a, address b, uint24 f) view returns (address)"];
const V3_POOL_ABI = [
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function liquidity() view returns (uint128)",
    "function token0() view returns (address)",
    "function token1() view returns (address)"
];
const ERC20_ABI = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];

// --- TOKENS CONFIG ---
const TOKENS = {
    WETH: { addr: "0x4200000000000000000000000000000000000006", decimals: 18 },
    USDC: { addr: "0x833589fcd6edb6e08f4c7c32d4f71b54b1a51ce3", decimals: 6 },
    CBETH: { addr: "0x2ae3f1ec7f1f5012cfeab0185f7005012d3397c9", decimals: 18 }
};

// --- PRICE MATH (Handles Decimal Differences) ---
function calculatePrice(sqrtPriceX96, dec0, dec1) {
    const sqrt = BigInt(sqrtPriceX96);
    const numerator = sqrt * sqrt * (10n ** BigInt(dec0));
    const denominator = (2n ** 192n) * (10n ** BigInt(dec1));
    
    // Returns price of token0 in terms of token1
    return Number(numerator) / Number(denominator);
}

async function detectArb() {
    console.log(`[${new Date().toISOString()}] Scanning for opportunities...`);
    
    const poolQueries = [];
    const tokenPairs = [
        [TOKENS.WETH, TOKENS.USDC],
        [TOKENS.CBETH, TOKENS.WETH]
    ];

    // 1. Build Batch Queries for Pool Addresses
    for (const [t0, t1] of tokenPairs) {
        const [a, b] = t0.addr < t1.addr ? [t0.addr, t1.addr] : [t1.addr, t0.addr];
        // Scan common fee tiers (500 = 0.05%, 3000 = 0.3%, 100 = 0.01%)
        [100, 500, 3000].forEach(fee => {
            poolQueries.push({ target: UNI_FACTORY, interface: FACTORY_ABI, method: 'getPool', args: [a, b, fee], meta: { dex: 'UniV3', t0, t1 } });
            poolQueries.push({ target: PANCAKE_FACTORY, interface: FACTORY_ABI, method: 'getPool', args: [a, b, fee], meta: { dex: 'PancakeV3', t0, t1 } });
            poolQueries.push({ target: AERO_SLIPSTREAM_FACTORY, interface: FACTORY_ABI, method: 'getPool', args: [a, b, fee], meta: { dex: 'Aerodrome', t0, t1 } });
        });
    }

    const [, poolAddresses] = await multi.aggregate(poolQueries);
    
    // 2. Build Batch Queries for Pool States (Slot0 & Liquidity)
    const stateQueries = [];
    poolAddresses.forEach((addr, i) => {
        if (addr !== ethers.constants.AddressZero) {
            stateQueries.push({ target: addr, interface: V3_POOL_ABI, method: 'slot0', meta: { ...poolQueries[i].meta, addr } });
            stateQueries.push({ target: addr, interface: V3_POOL_ABI, method: 'liquidity', meta: { ...poolQueries[i].meta, addr } });
        }
    });

    if (stateQueries.length === 0) return;
    const [, states] = await multi.aggregate(stateQueries);

    // 3. Process Results
    const activePools = [];
    for (let i = 0; i < states.length; i += 2) {
        const slot0 = states[i];
        const liquidity = states[i+1];
        const meta = stateQueries[i].meta;

        if (liquidity.gt(0)) {
            const price = calculatePrice(slot0.sqrtPriceX96.toString(), meta.t0.decimals, meta.t1.decimals);
            activePools.push({ ...meta, price, liquidity: liquidity.toString() });
        }
    }

    // 4. Compare Prices for Arbitrage
    for (let i = 0; i < activePools.length; i++) {
        for (let j = i + 1; j < activePools.length; j++) {
            const p1 = activePools[i];
            const p2 = activePools[j];

            if (p1.t0.addr === p2.t0.addr && p1.t1.addr === p2.t1.addr) {
                const diff = ((p1.price - p2.price) / p2.price) * 100;
                
                if (Math.abs(diff) > 0.5) { // 0.5% threshold
                    console.log(`
--- ARB DETECTED ---
Pair: ${p1.t0.addr < p1.t1.addr ? 'WETH/USDC' : 'USDC/WETH'}
Spread: ${diff.toFixed(4)}%
Buy on: ${diff > 0 ? p2.dex : p1.dex} (${diff > 0 ? p2.price : p1.price})
Sell on: ${diff > 0 ? p1.dex : p2.dex} (${diff > 0 ? p1.price : p2.price})
--------------------`);
                    // Call your executor here...
                }
            }
        }
    }
}

// Run loop
setInterval(async () => {
    try { await detectArb(); } catch (e) { console.error("Loop Error:", e.message); }
}, 5000);
