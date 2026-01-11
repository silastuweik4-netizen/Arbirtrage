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
        arbitrageContract: (() => {  
            const address = ethers.getAddress('0xaBcAd13dB95d80DEe0a96a12856e65A4210ca537');  
            console.log(`Arbitrage contract address is being loaded as : ${address}`);  
            return address;  
        })(),  
        uniswapV3Quoter: (() => {  
            const address = ethers.getAddress('0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a');  
            console.log(`uniswapV3Quoter address is being loaded as : ${address}`);  
            return address;  
        })(),  
        aerodromeRouter: (() => {  
            const address = ethers.getAddress('0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43');  
            console.log(`aerodromeRouter address is being loaded as : ${address}`);  
            return address;  
            })()  
    },  
  
    // Trading Settings  
    settings: {  
        executionThreshold: 5.00, // Minimum $5 profit to execute  
        maxFlashloanAmount: 1000, // Max amount to borrow in USD  
        gasLimit: 500000,  
        scanInterval: 10000 // 10 seconds  
    },  
  
    // Token List (Using Checksum Addresses)  
    tokens: {  
        'WETH': (() => {  
            const address = ethers.getAddress('0x4200000000000000000000000000000000000006');  
            console.log(`WETH address is being loaded as : ${address}`);  
            return address;  
        })(),  
        'USDC': (() => {  
            const address = ethers.getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');  
            console.log(`USDC address is being loaded as : ${address}`);  
            return address;  
        })(),  
        'USDbC': (() => {  
            const address = ethers.getAddress('0xd9aAEc2AD9CC7352E3049674812033E232768911');  
            console.log(`USDbC address is being loaded as : ${address}`);  
            return address;  
        })(),  
        'DAI': (() => {  
            const address = ethers.getAddress('0x50c5725949A6F0c72E6C4564183930E918605390');  
             console.log(`DAI address is being loaded as : ${address}`);  
            return address;  
        })(),  
        'cbBTC': (() => {  
            const address = ethers.getAddress('0xcbB7C915AB5C7E49998D870c1118C6f91c2E400C');  
            console.log(`cbBTC address is being loaded as : ${address}`);  
            return address;  
        })(),  
        'wstETH': (() => {  
            const address = ethers.getAddress('0xc1CBa3fC4D1301A46698759358619096E593bbBb');  
            console.log(`wstETH address is being loaded as : ${address}`);  
            return address  
        })(),  
        'DEGEN': (() => {  
            const address = ethers.getAddress('0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed');  
            console.log(`DEGEN address is being loaded as : ${address}`);  
            return address;  
        })(),  
        'AERO': (() => {  
            const address = ethers.getAddress('0x940181300A0940181300A0940181300A09401813');  
            console.log(`AERO address is being loaded as : ${address}`);  
            return address;  
        })(),  
        // ... (The bot will use the tokens defined in your full config.js)  
    },  
  
    // Pair List (55 Pairs)  
    pairs: [  
        { name: 'WETH/USDC', token0: 'WETH', token1: 'USDC', fee: 500 },  
        { name: 'WETH/USDbC', token0: 'WETH', token1: 'USDbC', fee: 500 },  
        { name: 'cbBTC/WETH', token0: 'cbBTC', token1: 'WETH', fee: 500 },  
        // ... (The bot will use the pairs defined in your full config.js)  
    ]  
};  
