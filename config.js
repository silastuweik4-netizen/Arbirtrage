// config.js - VERIFIED POOLS ONLY (checksummed addresses)
const { ethers } = require('ethers');

module.exports = {
    // Network Configuration
    BASE_RPC_URL: process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
    FLASHBOTS_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
    CHAIN_ID: 8453,

    // Wallet Configuration
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',

    // Contract Addresses (checksum-correct)
    contracts: {
        arbitrageContract:  ethers.getAddress('0x0301304b0fd60f178d2814f72b575e67a7987e1e'),
        uniswapQuoterV2:    ethers.getAddress('0x3d4e44eb1374240ce5f1b871ab261cd16335b76a'),
        uniswapRouter:      ethers.getAddress('0x2626664c2603336e57b271c5c0b26f421741e481'),
        aerodromeRouter:    ethers.getAddress('0xcf77a3ba9a5ca399b7c97c74d6e6b1aba2327f27'),
        aerodromeFactory:   ethers.getAddress('0x5c7363ff8ea0d7f0c5b5ef38ac925a6aac87300a')
    },

    // Trading Settings
    settings: {
        executionThreshold: 50,          // USD
        maxFlashloanAmount: '1000',
        gasLimit: 500_000,
        scanInterval: 30_000,
        depthAmount: 5,
        maxConcurrentChecks: 1,
        delayBetweenChecks: 2_000,
        oneShotMode: true,
        stopAfterSuccess: true,
        stopAfterFailure: false,
        minBalanceToOperate: 0.001,
        reserveGasBalance: 0.0005
    },

    // Token List (checksummed)
    tokens: {
        WETH:  { address: ethers.getAddress('0x4200000000000000000000000000000000000006'), decimals: 18, symbol: 'WETH' },
        USDC:  { address: ethers.getAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'), decimals: 6, symbol: 'USDC' },
        USDbC: { address: ethers.getAddress('0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca'), decimals: 6, symbol: 'USDbC' },
        cbBTC: { address: ethers.getAddress('0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'), decimals: 8, symbol: 'cbBTC' },
        wstETH:{ address: ethers.getAddress('0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452'), decimals: 18, symbol: 'wstETH' },
        rETH:  { address: ethers.getAddress('0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c'), decimals: 18, symbol: 'rETH' }
    },

    // Pair List
    pairs: [
        { name: 'WETH/USDC', token0: 'WETH', token1: 'USDC', fee: 500 },
        { name: 'WETH/USDC', token0: 'WETH', token1: 'USDC', fee: 3000 },
        { name: 'USDC/USDbC', token0: 'USDC', token1: 'USDbC', fee: 100 },
        { name: 'wstETH/WETH', token0: 'wstETH', token1: 'WETH', fee: 500 },
        { name: 'rETH/WETH', token0: 'rETH', token1: 'WETH', fee: 500 },
        { name: 'cbBTC/WETH', token0: 'cbBTC', token1: 'WETH', fee: 3000 },
        { name: 'cbBTC/USDC', token0: 'cbBTC', token1: 'USDC', fee: 500 }
    ]
};
