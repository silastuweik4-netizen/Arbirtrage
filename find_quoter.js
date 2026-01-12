const { ethers } = require('./node_modules/ethers');
const config = require('./config');

async function find() {
    const rpc = process.env.BASE_RPC_URL || config.BASE_RPC_URL;
    const provider = new ethers.JsonRpcProvider(rpc);
    
    const addresses = [
        '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'.toLowerCase(), // QuoterV2 (User's)
        '0x61fFE01691351bdC1d392439F02f891369968a67'.toLowerCase(), // QuoterV2 (Official)
        '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'.toLowerCase()  // Quoter (Official)
    ];

    const abiV2 = ['function quoteExactInputSingle((address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'];
    const abiV1 = ['function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)'];

    for (const addr of addresses) {
        console.log(`\nChecking address: ${addr}`);
        try {
            const code = await provider.getCode(addr);
            if (code === '0x') {
                console.log('  - Not a contract');
                continue;
            }
        } catch (e) {
            console.log('  - Error getting code:', e.message);
            continue;
        }

        // Try V2
        try {
            const quoter = new ethers.Contract(addr, abiV2, provider);
            const result = await quoter.quoteExactInputSingle.staticCall({
                tokenIn: config.tokens['WETH'].address,
                tokenOut: config.tokens['USDC'].address,
                fee: 500,
                amountIn: ethers.parseUnits('0.1', 18),
                sqrtPriceLimitX96: 0
            });
            console.log('  - ✅ V2 Success! Amount out:', ethers.formatUnits(result[0], 6));
            continue;
        } catch (e) {
            // console.log('  - V2 failed:', e.message);
        }

        // Try V1
        try {
            const quoter = new ethers.Contract(addr, abiV1, provider);
            const result = await quoter.quoteExactInputSingle.staticCall(
                config.tokens['WETH'].address,
                config.tokens['USDC'].address,
                500,
                ethers.parseUnits('0.1', 18),
                0
            );
            console.log('  - ✅ V1 Success! Amount out:', ethers.formatUnits(result, 6));
            continue;
        } catch (e) {
            // console.log('  - V1 failed:', e.message);
        }
        
        console.log('  - ❌ Both V1 and V2 failed');
    }
}

find().catch(console.error);
