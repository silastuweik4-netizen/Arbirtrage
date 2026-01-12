const { ethers } = require('ethers');
const config = require('./config');
const { QUOTER_V2_ABI, AERODROME_ROUTER_ABI } = require('./abis');

async function scanAllPairs() {
  console.log('🚀 Starting Full Scan of 15 Token Pairs on Base Network\n');
  
  const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL);
  const uniswapQuoterAddr = config.contracts.uniswapQuoterV2;
  const aerodromeRouterAddr = config.contracts.aerodromeRouter;
  
  const uniswapQuoter = new ethers.Contract(uniswapQuoterAddr, QUOTER_V2_ABI, provider);
  const aerodromeRouter = new ethers.Contract(aerodromeRouterAddr, AERODROME_ROUTER_ABI, provider);

  console.log('| Pair | Uni Price | Aero Price | Net Profit ($) | Status |');
  console.log('| :--- | :--- | :--- | :--- | :--- |');

  for (const pair of config.pairs) {
    const t0 = config.tokens[pair.token0];
    const t1 = config.tokens[pair.token1];
    const testSize = 1.0; // Test with 1 unit

    try {
      const amountInRaw = ethers.parseUnits(testSize.toString(), t0.decimals);
      
      // Uni Quote (V2)
      const params = {
        tokenIn: t0.address,
        tokenOut: t1.address,
        amountIn: amountInRaw,
        fee: pair.fee,
        sqrtPriceLimitX96: 0
      };
      const uniResult = await uniswapQuoter.quoteExactInputSingle.staticCall(params);
      const uniOut = parseFloat(ethers.formatUnits(uniResult[0], t1.decimals));
      
      // Aero Quote
      const routes = [{ from: t0.address, to: t1.address, stable: false, factory: config.contracts.aerodromeFactory }];
      const aeroResult = await aerodromeRouter.getAmountsOut(amountInRaw, routes);
      const aeroOut = parseFloat(ethers.formatUnits(aeroResult[1], t1.decimals));

      const buyPrice = Math.min(uniOut / testSize, aeroOut / testSize);
      const sellPrice = Math.max(uniOut / testSize, aeroOut / testSize);
      
      const grossProfit = (sellPrice - buyPrice) * testSize;
      const flashloanFee = testSize * buyPrice * 0.0005;
      const netProfit = grossProfit - flashloanFee - 0.20;

      let status = netProfit > 0 ? '✅ PROFIT' : '❌ NO';
      console.log(`| ${t0.symbol}/${t1.symbol} (${pair.fee}) | ${uniOut.toFixed(4)} | ${aeroOut.toFixed(4)} | ${netProfit.toFixed(2)} | ${status} |`);

    } catch (e) {
      console.log(`| ${t0.symbol}/${t1.symbol} (${pair.fee}) | N/A | N/A | N/A | ⚠️ Error: ${e.message} |`);
    }
  }
}

scanAllPairs().catch(console.error);
