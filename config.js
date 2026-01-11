// config.js
module.exports = {
    // Network Configuration
    BASE_RPC_URL: 'https://rpc.ankr.com/base/7926978796684879687968796879687968796879687968796879687968796879',
    FLASHBOTS_RPC_URL: 'https://rpc.flashbots.net/base',
    CHAIN_ID: 8453,

    // Wallet Configuration (Read from Render Environment Variables)
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',

    // Contract Addresses
    contracts: {
        arbitrageContract:     '0xaBcAd13dB95d80DEe0a96a12856e65A4210ca537', // your deployed address
        uniswapQuoterV2:       '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
        aerodromeRouter:       '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
        aerodromeFactory:      '0x5C3F18F06CC09CA1910767A7a647aD5e8C9e2c5e'
    },

    // Trading Settings
    settings: {
        executionThreshold: 5.00,      // minimum $5 profit to execute
        maxFlashloanAmount: '1000',    // max borrow in USD
        gasLimit: 500000,
        scanInterval: 10000,           // 10 s
        updateInterval: 10000,         // 10 s (used in monitor loop)
        depthAmount: 10                // used by findOptimalSize
    },

    // Token List (core subset; extend as needed)
    tokens: {
        WETH:   { address: '0x4200000000000000000000000000000000000006',  decimals: 18 },
        USDC:   { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',  decimals: 6 },
        USDbC:  { address: '0xd9aAEc2AD9CC7352E3049674812033E232768911',  decimals: 6 },
        DAI:    { address: '0x50c5725949A6F0c72E6C4564183930E918605390',  decimals: 18 },
        cbBTC:  { address: '0xcbB7C915AB5C7E49998D870c1118C6f91c2E400C',  decimals: 8 },
        wstETH: { address: '0xc1CBa3fC4D1301A46698759358619096E593bbBb',  decimals: 18 },
        DEGEN:  { address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',  decimals: 18 },
        AERO:   { address: '0x940181300A0940181300A0940181300A09401813',  decimals: 18 },
        VIRTUAL:{ address: '0x0b3e328455822222222222222222222222222222',  decimals: 18 }
    },

    // Pair List (extend as needed)
    pairs: [
        { name: 'WETH/USDC',  token0: 'WETH',   token1: 'USDC',  fee: 500 },
        { name: 'WETH/USDbC', token0: 'WETH',   token1: 'USDbC', fee: 500 },
        { name: 'cbBTC/WETH', token0: 'cbBTC',  token1: 'WETH',  fee: 500 },
        { name: 'WETH/DAI',   token0: 'WETH',   token1: 'DAI',   fee: 500 }
    ]
};
