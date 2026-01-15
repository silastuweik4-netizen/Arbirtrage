// config.js - VERIFIED POOLS ONLY (Based on Liquidity Check)
module.exports = {
    // Network Configuration
    BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
    FLASHBOTS_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
    CHAIN_ID: 8453,

    // Wallet Configuration
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',
    
    // Contract Addresses
    contracts: {
        arbitrageContract: '0x0301304b0fd60f178d2814f72b575e67a7987e1e'.toLowerCase(),
        uniswapQuoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'.toLowerCase(),
        
        // CRITICAL FIX: Correct Uniswap V3 SwapRouter on Base
        uniswapRouter: '0x2626664c2603336E57B271c5C0b26F421741e481'.toLowerCase(),
        
        aerodromeRouter: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'.toLowerCase(),
        aerodromeFactory: '0x420dd381b31aef6683db6b902084cb0ffece40da'.toLowerCase()
    },

    // Trading Settings - CONSERVATIVE FOR TESTING
    settings: {
        // TESTING MODE: Set high threshold until we confirm first success
        executionThreshold: 50.00, // $50 minimum - only best opportunities
        
        maxFlashloanAmount: '1000',
        gasLimit: 500000,
        
        // Rate limiting - reduced to avoid Alchemy limits
        scanInterval: 30000, // 30 seconds
        depthAmount: 5, // Test 5 sizes (was 10)
        maxConcurrentChecks: 1, // One at a time
        delayBetweenChecks: 2000, // 2 seconds between pairs
        
        // One-shot mode
        oneShotMode: true,
        stopAfterSuccess: true,
        stopAfterFailure: false,
        
        // Balance protection
        minBalanceToOperate: 0.001,
        reserveGasBalance: 0.0005,
    },

    // Token List - VERIFIED ONLY
    tokens: {
        WETH: { address: '0x4200000000000000000000000000000000000006'.toLowerCase(), decimals: 18, symbol: 'WETH' },
        USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase(), decimals: 6, symbol: 'USDC' },
        USDbC: { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'.toLowerCase(), decimals: 6, symbol: 'USDbC' },
        cbBTC: { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'.toLowerCase(), decimals: 8, symbol: 'cbBTC' },
        wstETH: { address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452'.toLowerCase(), decimals: 18, symbol: 'wstETH' },
        rETH: { address: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c'.toLowerCase(), decimals: 18, symbol: 'rETH' },
    },

    // Pair List - VERIFIED WITH GOOD LIQUIDITY ONLY
    pairs: [
        // HIGHEST LIQUIDITY - Best for testing
        { name: 'WETH/USDC', token0: 'WETH', token1: 'USDC', fee: 500 },  // 0.05% fee tier
        { name: 'WETH/USDC', token0: 'WETH', token1: 'USDC', fee: 3000 }, // 0.3% fee tier
        
        // Good liquidity stablecoin pair
        { name: 'USDC/USDbC', token0: 'USDC', token1: 'USDbC', fee: 100 },
        
        // Liquid staking tokens (verified pools exist)
        { name: 'wstETH/WETH', token0: 'wstETH', token1: 'WETH', fee: 500 },
        { name: 'rETH/WETH', token0: 'rETH', token1: 'WETH', fee: 500 },
        
        // BTC pairs (good Uniswap liquidity)
        { name: 'cbBTC/WETH', token0: 'cbBTC', token1: 'WETH', fee: 3000 },
        { name: 'cbBTC/USDC', token0: 'cbBTC', token1: 'USDC', fee: 500 },
    ]
};
