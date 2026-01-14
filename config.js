module.exports = {
    BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
    FLASHBOTS_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
    CHAIN_ID: 8453,
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',

    /* ----  NEW CONTRACT WITH REVERT-BUBBLE PATCH  ---- */
    contracts: {
        arbitrageContract: '0x0000000000000000000000000000000000000000', // <-- REPLACE WITH YOUR NEW ADDRESS AFTER DEPLOY
        uniswapQuoterV2:   '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
        aerodromeRouter:   '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
        aerodromeFactory:  '0x420dd381b31aef6683db6b902084cb0ffece40da'
    },

    settings: {
        executionThreshold: 5.00,
        maxFlashloanAmount: '1000',
        gasLimit: 500000,
        scanInterval: 10000,
        depthAmount: 10,
        maxConcurrentChecks: 3,
        delayBetweenChecks: 200,
        oneShotMode: true,
        stopAfterSuccess: true,
        stopAfterFailure: false,
        minBalanceToOperate: 0.001,
        reserveGasBalance: 0.0005
    },

    tokens: {
        WETH:   { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH' },
        USDC:   { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6,  symbol: 'USDC' },
        USDbC:  { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6,  symbol: 'USDbC' },
        VIRTUAL:{ address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', decimals: 18, symbol: 'VIRTUAL' },
        BRETT:  { address: '0x532f27101965dd16442e59d40670faf5ebb142e4', decimals: 18, symbol: 'BRETT' },
        cbBTC:  { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', decimals: 8,  symbol: 'cbBTC' },
        AERO:   { address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631', decimals: 18, symbol: 'AERO' },
        cbETH:  { address: '0x2ae3f1ec7f1f5012cfeab268a9c344956f4467e3', decimals: 18, symbol: 'cbETH' },
        wstETH: { address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452', decimals: 18, symbol: 'wstETH' },
        rETH:   { address: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c', decimals: 18, symbol: 'rETH' }
    },

    pairs: [
        { name: 'WETH/USDC',    token0: 'WETH',   token1: 'USDC',   fee: 3000 },
        { name: 'WETH/USDbC',   token0: 'WETH',   token1: 'USDbC',  fee: 3000 },
        { name: 'USDC/USDbC',   token0: 'USDC',   token1: 'USDbC',  fee: 100  },
        { name: 'VIRTUAL/WETH', token0: 'VIRTUAL',token1: 'WETH',   fee: 3000 },
        { name: 'BRETT/WETH',   token0: 'BRETT',  token1: 'WETH',   fee: 3000 },
        { name: 'AERO/WETH',    token0: 'AERO',   token1: 'WETH',   fee: 3000 },
        { name: 'cbBTC/WETH',   token0: 'cbBTC',  token1: 'WETH',   fee: 3000 },
        { name: 'cbBTC/USDC',   token0: 'cbBTC',  token1: 'USDC',   fee: 3000 },
        { name: 'cbBTC/USDbC',  token0: 'cbBTC',  token1: 'USDbC',  fee: 3000 },
        { name: 'cbETH/WETH',   token0: 'cbETH',  token1: 'WETH',   fee: 500  },
        { name: 'wstETH/WETH',  token0: 'wstETH', token1: 'WETH',   fee: 500  },
        { name: 'rETH/WETH',    token0: 'rETH',   token1: 'WETH',   fee: 500  }
    ]
};
