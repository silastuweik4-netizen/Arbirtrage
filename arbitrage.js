//  arbitrage-v2.js  — with fallback endpoints
const fetch = require('node-fetch');

const JUPITER_ENDPOINTS = [
  'https://quote-api.jup.ag/v6',
  'https://api.jup.ag/quote/v6',
  'https://quote-api.jupiter.ag/v6'
];

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LOAN_AMOUNT = 1000 * 1e6;

async function tryJupiterEndpoints(inputMint, outputMint, amount) {
  for (const endpoint of JUPITER_ENDPOINTS) {
    try {
      console.log(`🔄 Trying Jupiter endpoint: ${endpoint}`);
      const response = await fetch(
        `${endpoint}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`
      );
      
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Success with ${endpoint}`);
        return data;
      }
    } catch (error) {
      console.log(`❌ ${endpoint} failed: ${error.message}`);
    }
  }
  return null;
}

async function scanArbitrage() {
  try {
    console.log('\n🔍 Scanning for arbitrage opportunities...');
    
    // Try USDC → SOL
    const quote1 = await tryJupiterEndpoints(USDC_MINT, SOL_MINT, LOAN_AMOUNT);
    if (!quote1) {
      console.log('❌ No USDC→SOL quotes from any endpoint');
      return null;
    }
    
    // Try SOL → USDC
    const quote2 = await tryJupiterEndpoints(SOL_MINT, USDC_MINT, quote1.outAmount);
    if (!quote2) {
      console.log('❌ No SOL→USDC quotes from any endpoint');
      return null;
    }
    
    // Calculate profit
    const grossProfit = Number(quote2.outAmount - LOAN_AMOUNT) / 1e6;
    const spreadBPS = Number(quote2.outAmount - LOAN_AMOUNT) / LOAN_AMOUNT * 10_000;
    const netProfit = grossProfit - (LOAN_AMOUNT * 0.0006) / 1e9;
    
    console.log(`📊 Spread: ${spreadBPS.toFixed(2)} BPS`);
    console.log(`💰 Gross: $${grossProfit.toFixed(4)}`);
    console.log(`🎯 Net: $${netProfit.toFixed(4)}`);
    
    return netProfit > 0.1 ? { spread: spreadBPS, gross: grossProfit, net: netProfit } : null;
    
  } catch (error) {
    console.error('💥 Arbitrage scan failed:', error.message);
    return null;
  }
}

module.exports = { scanArbitrage };
