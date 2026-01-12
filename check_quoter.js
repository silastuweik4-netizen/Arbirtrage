const { ethers } = require('./node_modules/ethers');
const config = require('./config');

async function check() {
    const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL);
    const quoterAddress = config.contracts.uniswapQuoterV2;
    
    // Try different ABI signatures
    const abis = [
        'function quoteExactInputSingle((address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
        'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
        'function quoteExactInputSingle(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)'
    ];

    for (const abi of abis) {
        console.log(`Testing ABI: ${abi}`);
        const quoter = new ethers.Contract(quoterAddress, [abi], provider);
        try {
            const t0 = config.tokens['WETH'].address;
            const t1 = config.tokens['USDC'].address;
            const amountIn = ethers.parseUnits('1', 18);
            
            let result;
            if (abi.includes('((')) {
                result = await quoter.quoteExactInputSingle.staticCall({
                    tokenIn: t0,
                    tokenOut: t1,
                    fee: 500,
                    amountIn: amountIn,
                    sqrtPriceLimitX96: 0
                });
            } else {
                result = await quoter.quoteExactInputSingle.staticCall(t0, t1, 500, amountIn, 0);
            }
            console.log('✅ Success! Result:', result);
            break;
        } catch (e) {
            console.log('❌ Failed:', e.message);
        }
    }
}

check().catch(console.error);
