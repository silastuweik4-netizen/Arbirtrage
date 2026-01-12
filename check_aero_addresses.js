const { ethers } = require('./node_modules/ethers');

async function check() {
    const rpc = 'https://mainnet.base.org';
    const provider = new ethers.JsonRpcProvider(rpc);
    
    const routerAddr = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43';
    const routerAbi = ['function factory() external view returns (address)'];
    const router = new ethers.Contract(routerAddr, routerAbi, provider);
    
    try {
        const factory = await router.factory();
        console.log('Aerodrome Factory from Router:', factory);
    } catch (e) {
        console.log('Failed to get factory from router:', e.message);
    }
}

check().catch(console.error);
