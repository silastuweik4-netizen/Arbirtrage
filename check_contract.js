const { ethers } = require('./node_modules/ethers');
const config = require('./config');

async function check() {
    const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL);
    const code = await provider.getCode(config.contracts.uniswapQuoterV2);
    console.log('Uniswap Quoter Code Length:', code.length);
    if (code === '0x') {
        console.log('❌ Uniswap Quoter address is NOT a contract!');
    } else {
        console.log('✅ Uniswap Quoter address is a contract.');
    }

    const aeroCode = await provider.getCode(config.contracts.aerodromeRouter);
    console.log('Aerodrome Router Code Length:', aeroCode.length);
}

check().catch(console.error);
