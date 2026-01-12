const { ethers } = require('./node_modules/ethers');
const config = require('./config');
const { AERODROME_ROUTER_ABI } = require('./abis');

async function check() {
    const rpc = 'https://mainnet.base.org';
    const provider = new ethers.JsonRpcProvider(rpc);
    const router = new ethers.Contract(config.contracts.aerodromeRouter, AERODROME_ROUTER_ABI, provider);
    
    const t0 = config.tokens['WETH'].address;
    const t1 = config.tokens['USDC'].address;
    const amountIn = ethers.parseUnits('1', 18);
    
    const routes = [{ from: t0, to: t1, stable: false, factory: config.contracts.aerodromeFactory }];
    
    try {
        const amounts = await router.getAmountsOut(amountIn, routes);
        console.log('✅ Aerodrome Success! Amount out:', ethers.formatUnits(amounts[1], 6));
    } catch (e) {
        console.log('❌ Aerodrome Failed:', e.message);
    }
}

check().catch(console.error);
