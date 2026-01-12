// config.js - FIXED VERSION
module.exports = {
    // Network Configuration
    BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/'httpshttps,
    
    // FIXED: Use Base-compatible RPC for execution
    // Options for Base MEV protection:
    // 1. Use same RPC as scanning (no MEV protection but works)
    // 2. Use private RPC service that supports Base
    // 3. Use Flashbots Protect (if available for Base)
    FLASHBOTS_RPC_URL: 'https://base-rpc.publicnode.com', // CHANGED: Same as scan RPC
    
    CHAIN_ID: 8453,

    // Wallet Configuration
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',
    
    // Contract Addresses
    contracts: {
        arbitrageContract: '0xaBcAd13dB95d80DEe0a96a12856e65A4210ca537'.toLowerCase(),
        uniswapQuoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'.toLowerCase(),
        aerodromeRouter: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'.toLowerCase(),
        
        // FIXED: Correct Aerodrome Factory address
        aerodromeFactory: '0x420dd381b31aef6683db6b902084cb0ffece40da'.toLowerCase()
    },

    // Trading Settings
    settings: {
        executionThreshold: 5.00,
        maxFlashloanAmount: '1000',
        gasLimit: 500000,
        scanInterval: 10000, // 10 seconds
        depthAmount: 10,
        
        // NEW: Rate limiting settings
        maxConcurrentChecks: 3, // Limit parallel pair checks to avoid RPC rate limits
        delayBetweenChecks: 200, // 200ms delay between checks
    },

    // Token List - ONLY VERIFIED TOKENS
    // Removed all placeholder/fake addresses
    tokens: {
        WETH: { address: '0x4200000000000000000000000000000000000006'.toLowerCase(), decimals: 18, symbol: 'WETH' },
        USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase(), decimals: 6, symbol: 'USDC' },
        USDbC: { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'.toLowerCase(), decimals: 6, symbol: 'USDbC' },
        
        // FIXED: Correct VIRTUAL address
        VIRTUAL: { address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b'.toLowerCase(), decimals: 18, symbol: 'VIRTUAL' },
        
        BRETT: { address: '0x532f27101965dd16442e59d40670faf5ebb142e4'.toLowerCase(), decimals: 18, symbol: 'BRETT' },
        cbBTC: { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'.toLowerCase(), decimals: 8, symbol: 'cbBTC' },
        
        // Verified DeFi tokens
        AERO: { address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631'.toLowerCase(), decimals: 18, symbol: 'AERO' },
        
        // Staked ETH variants - VERIFIED
        cbETH: { address: '0x2ae3f1ec7f1f5012cfeab268a9c344956f4467e3'.toLowerCase(), decimals: 18, symbol: 'cbETH' },
        wstETH: { address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452'.toLowerCase(), decimals: 18, symbol: 'wstETH' },
        rETH: { address: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c'.toLowerCase(), decimals: 18, symbol: 'rETH' },
        
        // NOTE: Other tokens removed until verified. Add them back after validation.
    },

    // Pair List - ONLY VERIFIED TOKEN PAIRS
    // Reduced to working pairs only
    pairs: [
        // High liquidity pairs
        { name: 'WETH/USDC', token0: 'WETH', token1: 'USDC', fee: 3000 },
        { name: 'WETH/USDbC', token0: 'WETH', token1: 'USDbC', fee: 3000 },
        { name: 'USDC/USDbC', token0: 'USDC', token1: 'USDbC', fee: 100 },
        
        // Verified token pairs
        { name: 'VIRTUAL/WETH', token0: 'VIRTUAL', token1: 'WETH', fee: 3000 },
        { name: 'BRETT/WETH', token0: 'BRETT', token1: 'WETH', fee: 3000 },
        { name: 'AERO/WETH', token0: 'AERO', token1: 'WETH', fee: 3000 },
        
        // cbBTC pairs
        { name: 'cbBTC/WETH', token0: 'cbBTC', token1: 'WETH', fee: 3000 },
        { name: 'cbBTC/USDC', token0: 'cbBTC', token1: 'USDC', fee: 3000 },
        { name: 'cbBTC/USDbC', token0: 'cbBTC', token1: 'USDbC', fee: 3000 },
        
        // Staked ETH pairs
        { name: 'cbETH/WETH', token0: 'cbETH', token1: 'WETH', fee: 500 },
        { name: 'wstETH/WETH', token0: 'wstETH', token1: 'WETH', fee: 500 },
        { name: 'rETH/WETH', token0: 'rETH', token1: 'WETH', fee: 500 },
    ]
};
