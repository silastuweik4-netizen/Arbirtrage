//  start-flash.js  — COMPLETE flash loan arbitrage system
require('dotenv').config();

console.log('🚀 SOLANA FLASH ARB - MEV PROTECTED');
console.log('Time:', new Date().toLocaleString());

const { KaminoFlashEngine } = require('./kamino-flash-engine');
const { notifyProfit } = require('./notify-profit');

// Initialize flash engine
const engine = new KaminoFlashEngine(
  wallet, // Your wallet keypair
  process.env.RPC_URL || 'https://api.mainnet-beta.solana.com'
);

// Flash loan amounts (in micro-USDC)
const FLASH_AMOUNTS = [
  5000 * 1e6,   // $5,000
  10000 * 1e6,  // $10,000  
  25000 * 1e6   // $25,000
];

let totalFlashProfit = 0;
let flashTradeCount = 0;

setInterval(async () => {
  console.log('\n⏰ Starting flash loan cycle...');
  
  // Try different loan amounts for best opportunities
  for (const loanAmount of FLASH_AMOUNTS) {
    console.log(`\n💰 Testing ${(loanAmount/1e6).toLocaleString()} USDC flash loan...`);
    
    const result = await engine.executeFlashLoanArbitrage(loanAmount);
    
    if (result && result.status === 'submitted') {
      // Track profits
      totalFlashProfit += result.profit;
      flashTradeCount++;
      
      console.log(`✅ FLASH LOAN SUCCESSFUL!`);
      console.log(`💰 Profit: $${result.profit.toFixed(4)}`);
      console.log(`📊 Total flash profits: $${totalFlashProfit.toFixed(4)}`);
      console.log(`🔢 Flash trades: ${flashTradeCount}`);
      
      // Notify about flash loan profit
      await notifyProfit({
        ...result,
        type: 'FLASH_LOAN',
        amount: loanAmount
      });
      
      break; // Don't test smaller amounts if larger one worked
    }
  }
  
}, 30000); // Every 30 seconds

// Initial scan
setTimeout(async () => {
  console.log('🎯 Initial flash loan scan...');
  // Test smallest amount first
  await engine.executeFlashLoanArbitrage(5000 * 1e6);
}, 5000);
