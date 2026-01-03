const { ethers } = require('ethers');
const config = require('./config');
const { QUOTER_V2_ABI, AERODROME_ROUTER_ABI } = require('./abis');

async function testOptimization() {
  console.log('🔍 Dynamic Trade Size Optimization Test\n');
  
  const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL);
  const uniswapQuoterAddr = config.contracts.uniswapQuoterV2 || '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
  const aerodromeRouterAddr = config.contracts.aerodromeRouter || '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43';
  const uniswapQuoter = new ethers.Contract(uniswapQuoterAddr, QUOTER_V2_ABI, provider);
  const aerodromeRouter = new ethers.Contract(aerodromeRouterAddr, AERODROME_ROUTER_ABI, provider);

  const pairsToTest = [
    { token0: 'WETH', token1: 'USDC', fee: 3000 },
    { token0: 'WETH', token1: 'USDC', fee: 500 },
    { token0: 'WETH', token1: 'USDbC', fee: 3000 },
    { token0: 'WETH', token1: 'OP', fee: 3000 },
    { token0: 'WETH', token1: 'OP', fee: 500 },
    { token0: 'WBTC', token1: 'USDC', fee: 3000 },
    { token0: 'WBTC', token1: 'WETH', fee: 3000 },
    { token0: 'cbBTC', token1: 'WETH', fee: 3000 },
    { token0: 'cbBTC', token1: 'USDC', fee: 3000 },
    { token0: 'wstETH', token1: 'WETH', fee: 3000 },
    { token0: 'wstETH', token1: 'WETH', fee: 500 },
  ];

  for (const pair of pairsToTest) {
    const t0 = config.tokens[pair.token0];
    const t1 = config.tokens[pair.token1];
    console.log(`--- Testing Pair: ${t0.symbol}/${t1.symbol} ---`);
    
    let bestSize = 0;
    let maxProfit = 0;

    // Test sizes from 0.1 to 10 units
    for (let size = 0.5; size <= 10; size += 0.5) {
      try {
        const amountInRaw = ethers.parseUnits(size.toString(), t0.decimals);
        
        // Uni Quote
        const params = { tokenIn: t0.address, tokenOut: t1.address, amountIn: amountInRaw, fee: pair.fee, sqrtPriceLimitX96: 0 };
        const uniResult = await uniswapQuoter.quoteExactInputSingle.staticCall(params);
        const uniOut = parseFloat(ethers.formatUnits(uniResult[0], t1.decimals));
        
        // Aero Quote
        const routes = [{ from: t0.address, to: t1.address, stable: false, factory: config.contracts.aerodromeFactory }];
        const aeroResult = await aerodromeRouter.getAmountsOut(amountInRaw, routes);
        const aeroOut = parseFloat(ethers.formatUnits(aeroResult[1], t1.decimals));

        const buyPrice = Math.min(uniOut / size, aeroOut / size);
        const sellPrice = Math.max(uniOut / size, aeroOut / size);
        
        const grossProfit = (sellPrice - buyPrice) * size;
        const flashloanFee = size * buyPrice * 0.0005;
        const netProfit = grossProfit - flashloanFee - 0.20;

        console.log(`Size: ${size.toFixed(1)} | Net Profit: $${netProfit.toFixed(2)}`);

        if (netProfit > maxProfit) {
          maxProfit = netProfit;
          bestSize = size;
        }
      } catch (e) {
        console.log(`Size: ${size.toFixed(1)} | Failed (Insufficient Liquidity)`);
      }
    }
    console.log(`\n✅ OPTIMAL SIZE for ${t0.symbol}/${t1.symbol}: ${bestSize} units (Profit: $${maxProfit.toFixed(2)})\n`);
  }
}

testOptimization().catch(console.error);
