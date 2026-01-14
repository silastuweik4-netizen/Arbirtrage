// config.js - Updated with correct Uniswap V3 fee tiers for Base (Jan 2026)
// Most popular pairs use 0.3% (3000) or 0.05% (500) — many memecoins are Aerodrome-only

module.exports = {
    // Network Configuration
    BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
    FLASHBOTS_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
    CHAIN_ID: 8453,

    // Wallet Configuration
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',

    // Contract Addresses
    contracts: {
        arbitrageContract: '0x0301304b0fd60f178d2814f72b575e67a7987e1e'.toLowerCase(), // ← replace after redeploy if needed
        uniswapQuoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'.toLowerCase(),
        uniswapFactory: '0x33128a8fC178698fC40c6babd9531205294FDf91'.toLowerCase(),
        aerodromeRouter: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'.toLowerCase(),
        aerodromeFactory: '0x420dd381b31aef6683db6b902084cb0ffece40da'.toLowerCase()
    },

    // Trading Settings
    settings: {
        executionThreshold: 5.00,           // USD — keep or lower to 1.00 for testing
        maxFlashloanAmount: '1000',
        gasLimit: 500000,
        scanInterval: 8000,                 // 8 seconds — good for debugging
        depthAmount: 10,

        maxConcurrentChecks: 3,
        delayBetweenChecks: 200,            // 200 ms — reasonable balance

        oneShotMode: true,
        stopAfterSuccess: true,
        stopAfterFailure: true,

        minBalanceToOperate: 0.001,
        reserveGasBalance: 0.0005,

        slippageToleranceBps: 50,
        ethPriceUsd: 3000,
    },

    // Tokens - verified
    tokens: {
        WETH:   { address: '0x4200000000000000000000000000000000000006'.toLowerCase(), decimals: 18, symbol: 'WETH' },
        USDC:   { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase(), decimals: 6, symbol: 'USDC' },
        USDbC:  { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'.toLowerCase(), decimals: 6, symbol: 'USDbC' },
        VIRTUAL:{ address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b'.toLowerCase(), decimals: 18, symbol: 'VIRTUAL' },
        BRETT:  { address: '0x532f27101965dd16442e59d40670faf5ebb142e4'.toLowerCase(), decimals: 18, symbol: 'BRETT' },
        cbBTC:  { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'.toLowerCase(), decimals: 8, symbol: 'cbBTC' },
        AERO:   { address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631'.toLowerCase(), decimals: 18, symbol: 'AERO' },
        cbETH:  { address: '0x2ae3f1ec7f1f5012cfeab268a9c344956f4467e3'.toLowerCase(), decimals: 18, symbol: 'cbETH' },
        wstETH: { address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452'.toLowerCase(), decimals: 18, symbol: 'wstETH' },
        rETH:   { address: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c'.toLowerCase(), decimals: 18, symbol: 'rETH' },
    },

    // Updated pairs with realistic Uniswap V3 fee tiers
    pairs: [
        // Core liquidity pairs (most likely to have Uniswap pools)
        { name: 'WETH/USDC',    token0: 'WETH', token1: 'USDC',   fee: 3000 },   // 0.3% is standard
        { name: 'WETH/USDbC',   token0: 'WETH', token1: 'USDbC',  fee: 3000 },   // Try 0.3% first
        { name: 'USDC/USDbC',   token0: 'USDC', token1: 'USDbC',  fee: 500   },   // 0.05% more common for correlated assets

        // Trending / memecoin pairs (many are Aerodrome-only — may still show no pool)
        { name: 'VIRTUAL/WETH', token0: 'VIRTUAL', token1: 'WETH', fee: 3000 },
        { name: 'BRETT/WETH',   token0: 'BRETT',   token1: 'WETH', fee: 3000 },
        { name: 'AERO/WETH',    token0: 'AERO',    token1: 'WETH', fee: 3000 },

        // Bitcoin-related pairs
        { name: 'cbBTC/WETH',   token0: 'cbBTC',   token1: 'WETH', fee: 3000 },   // 0.3% common
        { name: 'cbBTC/USDC',   token0: 'cbBTC',   token1: 'USDC', fee: 500   },   // 0.05% more likely
        { name: 'cbBTC/USDbC',  token0: 'cbBTC',   token1: 'USDbC', fee: 500   },

        // Liquid staking derivatives (usually 0.05%)
        { name: 'cbETH/WETH',   token0: 'cbETH',   token1: 'WETH', fee: 500   },
        { name: 'wstETH/WETH',  token0: 'wstETH',  token1: 'WETH', fee: 500   },
        { name: 'rETH/WETH',    token0: 'rETH',    token1: 'WETH', fee: 500   },
    ]
};
