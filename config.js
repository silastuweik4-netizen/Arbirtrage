// config.js - FIXED VERSION with Correct Fees, Increased Delays for RPC Safety
module.exports = {
    // Network Configuration - Alchemy MEV-Protected RPC (add fallback in bot)
    BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0 ',
    FLASHBOTS_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0 ',
    CHAIN_ID: 8453,

    // Wallet Configuration
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',
    
    // Contract Addresses - UPDATED WITH NEW FIXED CONTRACT (replace with your deployed address)
    contracts: {
        arbitrageContract: '0x0301304b0fd60f178d2814f72b575e67a7987e1e'.toLowerCase(), // UPDATE AFTER REDEPLOY
        uniswapQuoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'.toLowerCase(),
        uniswapFactory: '0x33128a8fC178698fC40c6babd9531205294FDf91'.toLowerCase(), // NEW: For pool checks
        aerodromeRouter: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'.toLowerCase(),
        aerodromeFactory: '0x420dd381b31aef6683db6b902084cb0ffece40da'.toLowerCase()
    },

    // Trading Settings
    settings: {
        executionThreshold: 5.00, // Minimum profit in USD to execute trade
        maxFlashloanAmount: '1000',
        gasLimit: 500000,
        scanInterval: 30000, // Increased to 30s to avoid rate limits
        depthAmount: 10, // Test up to 10 tokens for optimal trade size
        
        // Rate limiting settings (prevents RPC overload)
        maxConcurrentChecks: 3, // Check max 3 pairs simultaneously
        delayBetweenChecks: 500, // Increased to 500ms delay between initiating pair checks
        
        // === ONE-SHOT MODE SETTINGS ===
        oneShotMode: true, // Set to true to execute only ONCE then stop
        stopAfterSuccess: true, // Stop bot after first successful execution
        stopAfterFailure: true, // Stop bot after first execution attempt (success OR failure)
        
        // Balance protection settings
        minBalanceToOperate: 0.001, // Stop if balance drops below this (in ETH)
        reserveGasBalance: 0.0005, // Always keep this much ETH for future gas

        // --- Slippage Tolerance (in Basis Points, 50 = 0.5%) ---
        slippageToleranceBps: 50, // Adjust as needed (e.g., 50 = 0.5%, 100 = 1%)
        ethPriceUsd: 3000, // Optional: Add ETH price for better gas estimation
    },

    // Token List - ONLY VERIFIED TOKENS
    tokens: {
        WETH: { address: '0x4200000000000000000000000000000000000006'.toLowerCase(), decimals: 18, symbol: 'WETH' },
        USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase(), decimals: 6, symbol: 'USDC' },
        USDbC: { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'.toLowerCase(), decimals: 6, symbol: 'USDbC' },
        VIRTUAL: { address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b'.toLowerCase(), decimals: 18, symbol: 'VIRTUAL' },
        BRETT: { address: '0x532f27101965dd16442e59d40670faf5ebb142e4'.toLowerCase(), decimals: 18, symbol: 'BRETT' },
        cbBTC: { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'.toLowerCase(), decimals: 8, symbol: 'cbBTC' },
        AERO: { address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631'.toLowerCase(), decimals: 18, symbol: 'AERO' },
        cbETH: { address: '0x2ae3f1ec7f1f5012cfeab268a9c344956f4467e3'.toLowerCase(), decimals: 18, symbol: 'cbETH' },
        wstETH: { address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452'.toLowerCase(), decimals: 18, symbol: 'wstETH' },
        rETH: { address: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c'.toLowerCase(), decimals: 18, symbol: 'rETH' },
    },

    // Trading Pairs - FIXED FEES TO MATCH REAL POOLS (verified on Uniswap/Basescan)
    pairs: [
        // High liquidity pairs (best for arbitrage)
        { name: 'WETH/USDC', token0: 'WETH', token1: 'USDC', fee: 500 }, // 0.05% for stables
        { name: 'WETH/USDbC', token0: 'WETH', token1: 'USDbC', fee: 500 }, // 0.05%
        { name: 'USDC/USDbC', token0: 'USDC', token1: 'USDbC', fee: 100 }, // 0.01% for ultra-stables
        
        // Trending tokens
        { name: 'VIRTUAL/WETH', token0: 'VIRTUAL', token1: 'WETH', fee: 3000 }, // 0.3% for volatiles
        { name: 'BRETT/WETH', token0: 'BRETT', token1: 'WETH', fee: 3000 },
        { name: 'AERO/WETH', token0: 'AERO', token1: 'WETH', fee: 3000 },
        
        // Bitcoin pairs (use 500 for 0.05% as per real pools)
        { name: 'cbBTC/WETH', token0: 'cbBTC', token1: 'WETH', fee: 500 },
        { name: 'cbBTC/USDC', token0: 'cbBTC', token1: 'USDC', fee: 500 },
        { name: 'cbBTC/USDbC', token0: 'cbBTC', token1: 'USDbC', fee: 500 }, // Assuming similar; verify if pool exists
        
        // Liquid staking (lower fees)
        { name: 'cbETH/WETH', token0: 'cbETH', token1: 'WETH', fee: 500 },
        { name: 'wstETH/WETH', token0: 'wstETH', token1: 'WETH', fee: 500 },
        { name: 'rETH/WETH', token0: 'rETH', token1: 'WETH', fee: 500 },
    ]
};
