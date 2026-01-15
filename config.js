// config.js - Compatible version: Uniswap V3 + Aerodrome only (no contract changes needed)
module.exports = {
    BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
    FLASHBOTS_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
    CHAIN_ID: 8453,

    PRIVATE_KEY: process.env.PRIVATE_KEY || '',

    contracts: {
        arbitrageContract: '0x0301304b0fd60f178d2814f72b575e67a7987e1e'.toLowerCase(),
        uniswapQuoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'.toLowerCase(),
        uniswapFactory: '0x33128a8fC178698fC40c6babd9531205294FDf91'.toLowerCase(),
        aerodromeRouter: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'.toLowerCase(),
        aerodromeFactory: '0x420dd381b31aef6683db6b902084cb0ffece40da'.toLowerCase()
    },

    settings: {
        executionThreshold: 0.05,           // Very low – just to see any positive signal
        maxFlashloanAmount: '1000',
        gasLimit: 800000,
        scanInterval: 6000,                 // 6 seconds – frequent but not spammy
        depthAmount: 20,

        maxConcurrentChecks: 4,
        delayBetweenChecks: 150,

        oneShotMode: false,                 // Continuous monitoring
        stopAfterSuccess: false,
        stopAfterFailure: false,

        minBalanceToOperate: 0.001,
        reserveGasBalance: 0.0005,

        slippageToleranceBps: 80,
        ethPriceUsd: 3000,
    },

    tokens: {
        WETH:   { address: '0x4200000000000000000000000000000000000006'.toLowerCase(), decimals: 18, symbol: 'WETH' },
        USDC:   { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase(), decimals: 6, symbol: 'USDC' },
        cbBTC:  { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'.toLowerCase(), decimals: 8, symbol: 'cbBTC' },
        cbETH:  { address: '0x2ae3f1ec7f1f5012cfeab268a9c344956f4467e3'.toLowerCase(), decimals: 18, symbol: 'cbETH' },
        wstETH: { address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452'.toLowerCase(), decimals: 18, symbol: 'wstETH' },
        rETH:   { address: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c'.toLowerCase(), decimals: 18, symbol: 'rETH' },
    },

    pairs: [
        // Only pairs with confirmed Uniswap V3 + Aerodrome pools
        { name: 'WETH/USDC',    token0: 'WETH', token1: 'USDC',   fee: 500   },
        { name: 'WETH/USDC',    token0: 'WETH', token1: 'USDC',   fee: 3000  },

        { name: 'cbETH/WETH',   token0: 'cbETH', token1: 'WETH',  fee: 500   },
        { name: 'wstETH/WETH',  token0: 'wstETH', token1: 'WETH', fee: 500   },
        { name: 'rETH/WETH',    token0: 'rETH', token1: 'WETH',   fee: 500   },

        { name: 'cbBTC/WETH',   token0: 'cbBTC', token1: 'WETH',  fee: 3000  },
        { name: 'cbBTC/USDC',   token0: 'cbBTC', token1: 'USDC',  fee: 500   },
    ]
};
