require("dotenv").config();
const { ethers } = require("ethers");
const { MultiCall } = require("@indexed-finance/multicall");

// RPC for Base Mainnet
const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

// Correctly initialize MultiCall instance
const multi = new MultiCall(provider);

// --- FACTORY ADDRESSES (Base Mainnet) ---
const UNI_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const PANCAKE_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865";
const AERO_SLIPSTREAM_FACTORY = "0x5e7F9738f3f9d14029145563f4329E6a02Ae9e9f";

// --- ABIs ---
const FACTORY_ABI = ["function getPool(address a, address b, uint24 f) view returns (address)"];
const V3_POOL_ABI = [
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function liquidity() view returns (uint128)"
];

// --- TOKENS CONFIG ---
const TOKENS = {
    WETH: { addr: "0x4200000000000000000000000000000000000006", decimals: 18 },
    USDC: { addr: "0x833589fcd6edb6e08f4c7c32d4f71b54b1a51ce3", decimals: 6 },
    CBETH: { addr: "0x2ae3f1ec7f1f5012cfeab0185f7005012d3397c9", decimals: 18 }
};

// Handle Decimal Differences for accurate 2026 pricing
function calculatePrice(sqrtPriceX96, dec0, dec1) {
    const sqrt = BigInt(sqrtPriceX96);
    const numerator = sqrt * sqrt * (10n ** BigInt(dec0));
    const denominator = (2n ** 192n) * (10n ** BigInt(dec1));
    return Number(numerator) / Number(denominator);
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
        const [a, b] = t0.addr < t1.addr ? [t0.addr, t1.addr] : [t1.addr, t0.addr];
        [500, 3000].forEach(fee => {
            poolQueries.push({ target: UNI_FACTORY, interface: FACTORY_ABI, method: 'getPool', args: [a, b, fee], meta: { dex: 'UniV3', t0, t1 } });
            poolQueries.push({ target: PANCAKE_FACTORY, interface: FACTORY_ABI, method: 'getPool', args: [a, b, fee], meta: { dex: 'PancakeV3', t0, t1 } });
            poolQueries.push({ target: AERO_SLIPSTREAM_FACTORY, interface: FACTORY_ABI, method: 'getPool', args: [a, b, fee], meta: { dex: 'Aerodrome', t0, t1 } });
        });
    }

    // Use multiCall instead of aggregate
    const poolAddresses = await multi.multiCall(poolQueries.map(q => ({
        target: q.target,
        function: q.method,
        args: q.args,
        interface: q.interface
    })));
    
    // 2. Prepare Pool State Queries
    const stateQueries = [];
    poolAddresses[1].forEach((addr, i) => {
        if (addr !== ethers.constants.AddressZero) {
            stateQueries.push({ target: addr, interface: V3_POOL_ABI, method: 'slot0', meta: { ...poolQueries[i].meta, addr } });
            stateQueries.push({ target: addr, interface: V3_POOL_ABI, method: 'liquidity', meta: { ...poolQueries[i].meta, addr } });
        }
    });

    if (stateQueries.length === 0) return;

    // Use multiCall for states
    const states = await multi.multiCall(stateQueries.map(q => ({
        target: q.target,
        function: q.method,
        interface: q.interface
    })));

    const results = states[1];
    const activePools = [];
    for (let i = 0; i < results.length; i += 2) {
        const slot0 = results[i];
        const liquidity = results[i+1];
        const meta = stateQueries[i].meta;

        if (liquidity && liquidity.gt(0)) {
            const price = calculatePrice(slot0.sqrtPriceX96.toString(), meta.t0.decimals, meta.t1.decimals);
            activePools.push({ ...meta, price });
        }
    }

    // 3. Compare Prices
    for (let i = 0; i < activePools.length; i++) {
        for (let j = i + 1; j < activePools.length; j++) {
            const p1 = activePools[i];
            const p2 = activePools[j];

            if (p1.t0.addr === p2.t0.addr && p1.t1.addr === p2.t1.addr) {
                const diff = ((p1.price - p2.price) / p2.price) * 100;
                if (Math.abs(diff) > 0.5) {
                    console.log(`[Arb] ${diff.toFixed(3)}% spread between ${p1.dex} and ${p2.dex}`);
                    // Trigger execution logic here
                }
            }
        }
    }
}

setInterval(async () => {
    try { await detectArb(); } catch (e) { console.error("Detection Error:", e.message); }
}, 10000);
