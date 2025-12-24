//  arbitrage-lite.js  — using NEW Jupiter Lite API
const fetch = require('node-fetch');

const JUPITER_LITE = 'https://lite-api.jup.ag/swap/v1/quote';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LOAN_AMOUNT = 1000 * 1e6; // $1,000

async function scanArbitrageLite() {
  try {
    console.log('\n🔍 Scanning with Jupiter Lite API...');
    
    // USDC → SOL quote
    console.log('🔄 Getting USDC→SOL quote...');
    const quote1 = await fetch(
      `${JUPITER_LITE}?inputMint=${USDC_MINT}&outputMint=${SOL_MINT}&amount=${LOAN_AMOUNT}&slippageBps=50`
    ).then(r => r.ok ? r.json() : null);
    
    if (!quote1) {
      console.log('❌ No USDC→SOL quote from Lite API');
      return null;
    }
    
    console.log('✅ USDC→SOL quote received');
    console.log('Route count:', quote1.routePlan?.length || 0);
    console.log('Expected output:', Number(quote1.outAmount) / 1e6, 'SOL');
    
    // SOL → USDC quote
    console.log('🔄 Getting SOL→USDC quote...');
    const quote2 = await fetch(
      `${JUPITER_LITE}?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${quote1.outAmount}&slippageBps=50`
    ).then(r => r.ok ? r.json() : null);
    
    if (!quote2) {
      console.log('❌ No SOL→USDC quote from Lite API');
      return null;
    }
    
    console.log('✅ SOL→USDC quote received');
    
    // Calculate profit
    const grossProfit = Number(quote2.outAmount - LOAN_AMOUNT) / 1e6;
    const spreadBPS = Number(quote2.outAmount - LOAN_AMOUNT) / LOAN_AMOUNT * 10_000;
    const netProfit = grossProfit - (LOAN_AMOUNT * 0.0006) / 1e9; // Subtract fees
    
    console.log(`📊 Spread: ${spreadBPS.toFixed(2)} BPS`);
    console.log(`💰 Gross: $${grossProfit.toFixed(4)}`);
    console.log(`🎯 Net: $${netProfit.toFixed(4)}`);
    
    if (netProfit > 0.1) { // $0.10 minimum
      console.log('🚨 PROFITABLE OPPORTUNITY WITH LITE API!');
      return {
        spread: spreadBPS,
        gross: grossProfit,
        net: netProfit,
        routeCount: quote1.routePlan?.length || 0,
        liquidity: Math.min(...quote1.routePlan.map(h => h.swapInfo.liquidityAvailable))
      };
    }
    
    console.log('❌ Not profitable enough');
    return null;
    
  } catch (error) {
    console.error('💥 Lite API scan failed:', error.message);
    return null;
  }
}

module.exports = { scanArbitrageLite };
