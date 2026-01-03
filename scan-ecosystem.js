const { ethers } = require('ethers');
const config = require('./config');
const { QUOTER_V2_ABI, AERODROME_ROUTER_ABI } = require('./abis');

async function scanEcosystem() {
  console.log('🚀 Starting Targeted Ecosystem Scan (AERO, VIRTUAL, USDbC)\n');
  
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
    
    // Use a relevant test size for the token (e.g., 100 AERO, 100 VIRTUAL, 1 WETH)
    const testSize = (t0.symbol === 'WETH' || t0.symbol === 'cbBTC') ? 1.0 : 100.0;

    try {
      const amountInRaw = ethers.parseUnits(testSize.toString(), t0.decimals);
      
      // Uni Quote
      const params = { tokenIn: t0.address, tokenOut: t1.address, amountIn: amountInRaw, fee: pair.fee, sqrtPriceLimitX96: 0 };
      const uniResult = await uniswapQuoter.quoteExactInputSingle.staticCall(params);
      const uniOut = parseFloat(ethers.formatUnits(uniResult[0], t1.decimals));
      
      // Aero Quote
      const routes = [{ from: t0.address, to: t1.address, stable: false, factory: config.contracts.aerodromeFactory }];
      const aeroResult = await aerodromeRouter.getAmountsOut(amountInRaw, routes);
      const aeroOut = parseFloat(ethers.formatUnits(aeroResult[1], t1.decimals));

      const buyPrice = Math.min(uniOut / testSize, aeroOut / testSize);
      const sellPrice = Math.max(uniOut / testSize, aeroOut / testSize);
      
      const grossProfit = (sellPrice - buyPrice) * testSize;
      
      // Calculate profit in USD for reporting
      let profitInUSD = 0;
      if (t1.symbol === 'USDC' || t1.symbol === 'USDbC') {
        profitInUSD = grossProfit;
      } else if (t1.symbol === 'WETH') {
        profitInUSD = grossProfit * 3000; // Approx ETH price
      }

      const flashloanFee = testSize * buyPrice * 0.0005;
      const netProfitUSD = profitInUSD - (flashloanFee * (t1.symbol === 'WETH' ? 3000 : 1)) - 0.20;

      let status = netProfitUSD > 0 ? '✅ PROFIT' : '❌ NO';
      console.log(`| ${t0.symbol}/${t1.symbol} (${pair.fee}) | ${uniOut.toFixed(4)} | ${aeroOut.toFixed(4)} | ${netProfitUSD.toFixed(2)} | ${status} |`);

    } catch (e) {
      console.log(`| ${t0.symbol}/${t1.symbol} (${pair.fee}) | N/A | N/A | N/A | ⚠️ Error |`);
    }
  }
}

scanEcosystem().catch(console.error);
