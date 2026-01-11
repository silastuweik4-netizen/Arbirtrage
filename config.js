// config.js
const { ethers } = require('ethers');

// Helper function to get checksum addresses
function getAddress(address) {
  try {
    return ethers.getAddress(address);
  } catch (e) {
    return address;
  }
}

module.exports = {
    // Network Configuration
    BASE_RPC_URL: 'https://g.w.lavanet.xyz:443/gateway/base/rpc-http/74c33b48f194b4900d1b1d4b108fd2ae',
    FLASHBOTS_RPC_URL: 'https://rpc.flashbots.net/base',
    CHAIN_ID: 8453,

    // Wallet Configuration (Read from Render Environment Variables)
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',
    
    // Contract Addresses (all in checksum format)
    contracts: {
        arbitrageContract: getAddress('0xaBcAd13dB95d80DEe0a96a12856e65A4210ca537'),
        uniswapV3Quoter: getAddress('0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'),
        aerodromeRouter: getAddress('0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'),
        aerodromeFactory: getAddress('0x420DD381b31aEf6683db6B902084cB0FFECe40Da')
    },

    // Trading Settings
    settings: {
        executionThreshold: 5.00, // Minimum $5 profit to execute
        maxFlashloanAmount: 1000, // Max amount to borrow in USD
        gasLimit: 500000,
        scanInterval: 30000 // 30 seconds (reduced from 10)
    },

    // Token List (with decimals and checksum addresses)
    tokens: {
        'WETH': { 
            name: 'WETH',
            address: getAddress('0x4200000000000000000000000000000000000006'), 
            decimals: 18,
            symbol: 'WETH'
        },
        'USDC': { 
            name: 'USDC',
            address: getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'), 
            decimals: 6,
            symbol: 'USDC'
        },
        'USDbC': { 
            name: 'USDbC',
            address: getAddress('0xd9aAEc2AD9CC7352E3049674812033E232768911'), 
            decimals: 6,
            symbol: 'USDbC'
        },
        'DAI': { 
            name: 'DAI',
            address: getAddress('0x50c5725949A6F0c72E6C4564183930E918605390'), 
            decimals: 18,
            symbol: 'DAI'
        },
        'cbBTC': { 
            name: 'cbBTC',
            address: getAddress('0xcbB7C915AB5C7E49998D870c1118C6f91c2E400C'), 
            decimals: 8,
            symbol: 'cbBTC'
        },
        'wstETH': { 
            name: 'wstETH',
            address: getAddress('0xc1CBa3fC4D1301A46698759358619096E593bbBb'), 
            decimals: 18,
            symbol: 'wstETH'
        },
        'DEGEN': { 
            name: 'DEGEN',
            address: getAddress('0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed'), 
            decimals: 18,
            symbol: 'DEGEN'
        },
        'AERO': { 
            name: 'AERO',
            address: getAddress('0x940181300A0940181300A0940181300A09401813'), 
            decimals: 18,
            symbol: 'AERO'
        }
    },

    // Pair List
    pairs: [
        { 
            name: 'WETH/USDC', 
            token0: 'WETH', 
            token1: 'USDC', 
            fee: 500,
            enabled: true 
        },
        { 
            name: 'WETH/USDbC', 
            token0: 'WETH', 
            token1: 'USDbC', 
            fee: 500,
            enabled: true 
        },
        { 
            name: 'cbBTC/WETH', 
            token0: 'cbBTC', 
            token1: 'WETH', 
            fee: 500,
            enabled: false // Disable until we fix price calculations
        },
        { 
            name: 'wstETH/WETH', 
            token0: 'wstETH', 
            token1: 'WETH', 
            fee: 500,
            enabled: false // Disable until we fix price calculations
        },
        { 
            name: 'DAI/USDC', 
            token0: 'DAI', 
            token1: 'USDC', 
            fee: 500,
            enabled: true 
        },
        { 
            name: 'AERO/WETH', 
            token0: 'AERO', 
            token1: 'WETH', 
            fee: 3000,
            enabled: true 
        },
        { 
            name: 'DEGEN/WETH', 
            token0: 'DEGEN', 
            token1: 'WETH', 
            fee: 10000,
            enabled: true 
        }
    ]
};
