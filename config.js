// config.js
module.exports = {
    // Network Configuration
    BASE_RPC_URL: 'https://base.llamarpc.com',
    FLASHBOTS_RPC_URL: 'https://rpc.flashbots.net/base',
    CHAIN_ID: 8453,

    // Wallet Configuration
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',
    
    // Contract Addresses
    contracts: {
        arbitrageContract: '0xaBcAd13dB95d80DEe0a96a12856e65A4210ca537'.toLowerCase(),
        uniswapQuoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'.toLowerCase(),
        aerodromeRouter: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'.toLowerCase(),
        aerodromeFactory: '0x0000000000000000000000000000000000000000'
    },

    // Trading Settings
    settings: {
        executionThreshold: 5.00,
        maxFlashloanAmount: '1000',
        gasLimit: 500000,
        scanInterval: 10000,
        depthAmount: 10
    },

    // Token List
    tokens: {
        'WETH': { address: '0x4200000000000000000000000000000000000006'.toLowerCase(), decimals: 18, symbol: 'WETH' },
        'USDC': { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase(), decimals: 6, symbol: 'USDC' },
        'USDbC': { address: '0xd9AaEC2AD9CC7352E3049674812033E232768911'.toLowerCase(), decimals: 6, symbol: 'USDbC' },
        'cbBTC': { address: '0xCbb7c915Ab5C7e49998D870C1118C6f91c2E400c'.toLowerCase(), decimals: 8, symbol: 'cbBTC' },
        'AERO': { address: '0x940181300A0940181300A0940181300A09401813'.toLowerCase(), decimals: 18, symbol: 'AERO' },
        'VIRTUAL': { address: '0x0b3E328455822222222222222222222222222222'.toLowerCase(), decimals: 18, symbol: 'VIRTUAL' }
    },

    // Pair List
    pairs: [
        { name: 'WETH/USDC', token0: 'WETH', token1: 'USDC', fee: 500 },
        { name: 'WETH/USDbC', token0: 'WETH', token1: 'USDbC', fee: 500 },
        { name: 'cbBTC/WETH', token0: 'cbBTC', token1: 'WETH', fee: 500 },
        { name: 'AERO/USDC', token0: 'AERO', token1: 'USDC', fee: 3000 },
        { name: 'VIRTUAL/WETH', token0: 'VIRTUAL', token1: 'WETH', fee: 3000 }
    ]
};
