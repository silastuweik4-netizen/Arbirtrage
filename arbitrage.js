//  arbitrage.js  — core arbitrage logic
const fetch = require('node-fetch');

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LOAN_AMOUNT = 1000 * 1e6; // $1,000

async function scanArbitrage() {
  try {
    console.log('\n🔍 Scanning for arbitrage opportunities...');
    
    // Get quote: USDC → SOL
    const quote1 = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${USDC_MINT}&outputMint=${SOL_MINT}&amount=${LOAN_AMOUNT}&slippageBps=50`
    ).then(r => r.ok ? r.json() : null);
    
    if (!quote1) {
      console.log('❌ No USDC→SOL quote');
      return null;
    }
    
    // Get quote: SOL → USDC  
    const quote2 = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${quote1.outAmount}&slippageBps=50`
    ).then(r => r.ok ? r.json() : null);
    
    if (!quote2) {
      console.log('❌ No SOL→USDC quote');
      return null;
    }
    
    // Calculate profit
    const grossProfit = Number(quote2.outAmount - LOAN_AMOUNT) / 1e6;
    const spreadBPS = Number(quote2.outAmount - LOAN_AMOUNT) / LOAN_AMOUNT * 10_000;
    const netProfit = grossProfit - (LOAN_AMOUNT * 0.0006) / 1e9; // Subtract fees
    
    console.log(`📊 Spread: ${spreadBPS.toFixed(2)} BPS`);
    console.log(`💰 Gross: $${grossProfit.toFixed(4)}`);
    console.log(`🎯 Net: $${netProfit.toFixed(4)}`);
    
    if (netProfit > 0.1) { // $0.10 minimum
      console.log('🚨 PROFITABLE OPPORTUNITY DETECTED!');
      return {
        spread: spreadBPS,
        gross: grossProfit,
        net: netProfit,
        route: quote1.routePlan,
        liquidity: Math.min(...quote1.routePlan.map(h => h.swapInfo.liquidityAvailable))
      };
    }
    
    console.log('❌ Not profitable enough');
    return null;
    
  } catch (error) {
    console.error('💥 Arbitrage scan failed:', error.message);
    return null;
  }
}

module.exports = { scanArbitrage };
