// config.js - Complete version with BTC/LST focus + realistic fees
module.exports = {
    BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
    FLASHBOTS_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
    CHAIN_ID: 8453,

    PRIVATE_KEY: process.env.PRIVATE_KEY || '',

    contracts: {
        arbitrageContract: '0x0301304b0fd60f178d2814f72b575e67a7987e1e'.toLowerCase(), // UPDATE after any redeploy
        uniswapQuoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'.toLowerCase(),
        uniswapFactory: '0x33128a8fC178698fC40c6babd9531205294FDf91'.toLowerCase(),
        aerodromeRouter: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'.toLowerCase(),
        aerodromeFactory: '0x420dd381b31aef6683db6b902084cb0ffece40da'.toLowerCase(),
        sushiRouter: '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f'.toLowerCase(),
        sushiQuoter: '0x64e8802fe490fa7cc61d3463958199161bb608a7'.toLowerCase(),
        sushiFactory: '0x917933899c6a5f8e37f31e19f92cdbff7e8ff0e2'.toLowerCase()
    },

    settings: {
        executionThreshold: 0.05,           // Very low – just to detect / log any tiny positive
        maxFlashloanAmount: '1000',
        gasLimit: 800000,
        scanInterval: 6000,
        depthAmount: 20,

        maxConcurrentChecks: 4,
        delayBetweenChecks: 150,

        oneShotMode: false,
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
        USDbC:  { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'.toLowerCase(), decimals: 6, symbol: 'USDbC' },
        cbBTC:  { address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'.toLowerCase(), decimals: 8, symbol: 'cbBTC' },
        cbETH:  { address: '0x2Ae3F1ec7F1F5012CFEA b268a9c344956f4467e3'.toLowerCase(), decimals: 18, symbol: 'cbETH' },
        wstETH: { address: '0xc1CBa3fCEA344f92d9239c08c0568f6f2f0eE452'.toLowerCase(), decimals: 18, symbol: 'wstETH' },
        rETH:   { address: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c'.toLowerCase(), decimals: 18, symbol: 'rETH' },
        AERO:   { address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631'.toLowerCase(), decimals: 18, symbol: 'AERO' },
    },

    pairs: [
        // BTC-focused pairs (cbBTC wrappers)
        { name: 'WETH/cbBTC',   token0: 'WETH',  token1: 'cbBTC', fee: 3000 },
        { name: 'cbBTC/WETH',   token0: 'cbBTC', token1: 'WETH',  fee: 3000 },
        { name: 'cbBTC/USDC',   token0: 'cbBTC', token1: 'USDC',  fee: 500  },
        { name: 'cbBTC/cbETH',  token0: 'cbBTC', token1: 'cbETH', fee: 500  },
        { name: 'cbBTC/AERO',   token0: 'cbBTC', token1: 'AERO',  fee: 3000 },

        // LST-focused pairs (cross-LST + stable)
        { name: 'cbETH/WETH',   token0: 'cbETH', token1: 'WETH',  fee: 500  },
        { name: 'wstETH/WETH',  token0: 'wstETH', token1: 'WETH', fee: 500  },
        { name: 'rETH/WETH',    token0: 'rETH',  token1: 'WETH',  fee: 500  },
        { name: 'cbETH/USDC',   token0: 'cbETH', token1: 'USDC',  fee: 500  },
        { name: 'wstETH/USDC',  token0: 'wstETH', token1: 'USDC', fee: 500  },
        { name: 'rETH/USDC',    token0: 'rETH',  token1: 'USDC',  fee: 500  },
        { name: 'cbETH/wstETH', token0: 'cbETH', token1: 'wstETH', fee: 500  },
        { name: 'rETH/cbETH',   token0: 'rETH',  token1: 'cbETH', fee: 500  },

        // High-volume baseline
        { name: 'WETH/USDC',    token0: 'WETH',  token1: 'USDC',  fee: 500  },
        { name: 'WETH/USDC',    token0: 'WETH',  token1: 'USDC',  fee: 3000 },
        { name: 'AERO/USDC',    token0: 'AERO',  token1: 'USDC',  fee: 3000 },
    ]
};
