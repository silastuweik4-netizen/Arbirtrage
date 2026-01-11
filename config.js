const { ethers } = require('ethers');  
  
module.exports = {  
    // Network Configuration  
    BASE_RPC_URL: 'https://g.w.lavanet.xyz:443/gateway/base/rpc-http/74c33b48f194b4900d1b1d4b108fd2ae', // Your Ankr RPC  
    FLASHBOTS_RPC_URL: 'https://rpc.flashbots.net/base',  
    CHAIN_ID: 8453,  
  
    // Wallet Configuration (Read from Render Environment Variables)  
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',  
  
    // Contract Addresses (Using Checksum Addresses)  
    contracts: {  
        arbitrageContract: ethers.getAddress('0xaBcAd13dB95d80DEe0a96a12856e65A4210ca537'),  // Checksummed  
        uniswapV3Quoter: ethers.getAddress('0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'),   // Checksummed  
        aerodromeRouter: ethers.getAddress('0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'),    // Checksummed  
        aerodromeFactory: ethers.getAddress('0x420000000000000000000000000000000000003E')  
    },  
  
    // Trading Settings  
    settings: {  
        executionThreshold: 5.00, // Minimum $5 profit to execute  
        maxFlashloanAmount: 1000, // Max amount to borrow in USD  
        gasLimit: 2000000, //Adjust gas limit as needed  
        scanInterval: 10000 // 10 seconds  
    },  
  
    // Token List (Using Checksum Addresses)  
    tokens: {  
        'WETH': ethers.getAddress('0x4200000000000000000000000000000000000006'),  
        'USDC': ethers.getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),  
        'USDbC': ethers.getAddress('0xd9aAEc2AD9CC7352E3049674812033E232768911'),  
        'DAI': ethers.getAddress('0x50c5725949A6F0c72E6C4564183930E918605390'),  
        'cbBTC': ethers.getAddress('0xcbB7C915AB5C7E49998D870c1118C6f91c2E400C'),  
        'wstETH': ethers.getAddress('0xc1CBa3fC4D1301A46698759358619096E593bbBb'),  
        'DEGEN': ethers.getAddress('0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed'),  
        'AERO': ethers.getAddress('0x940181300A0940181300A0940181300A09401813'),  
    },  
  
    // Pair List (55 Pairs)  
    pairs: [  
        { name: 'WETH/USDC', token0: 'WETH', token1: 'USDC', fee: 500 },  
        { name: 'WETH/USDbC', token0: 'WETH', token1: 'USDbC', fee: 500 },  
        { name: 'cbBTC/WETH', token0: 'cbBTC', token1: 'WETH', fee: 500 },  
    ]  
};  
