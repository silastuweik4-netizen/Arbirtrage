const { ethers } = require('./node_modules/ethers');

async function check() {
    const rpc = 'https://base.llamarpc.com';
    const provider = new ethers.JsonRpcProvider(rpc);
    
    const routerAddr = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43';
    const routerAbi = [
        'function getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] routes) external view returns (uint256[] amounts)'
    ];
    const router = new ethers.Contract(routerAddr, routerAbi, provider);
    
    const t0 = '0x4200000000000000000000000000000000000006'; // WETH
    const t1 = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC
    const amountIn = ethers.parseUnits('1', 18);
    
    // Try without factory (some routers might use a default)
    const routes = [{ from: t0, to: t1, stable: false, factory: '0x0000000000000000000000000000000000000000' }];
    
    try {
        const amounts = await router.getAmountsOut(amountIn, routes);
        console.log('✅ Aerodrome V6 Success! Amount out:', ethers.formatUnits(amounts[1], 6));
    } catch (e) {
        console.log('❌ Aerodrome V6 Failed:', e.message);
    }
}

check().catch(console.error);
