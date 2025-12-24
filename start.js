//  start.js  — COMPLETE system with execution
require('dotenv').config();

console.log('🚀 SOLANA ARB V2 - COMPLETE SYSTEM');
console.log('Time:', new Date().toLocaleString());

const { simulateArbitrage } = require('./complete-arbitrage');
const { executeTrade } = require('./execute-trade');
const { notifyProfit } = require('./notify-profit');

let totalProfit = 0;
let tradeCount = 0;

setInterval(async () => {
  console.log('\n⏰ Starting complete arbitrage cycle...');
  
  const opportunity = await simulateArbitrage();
  
  if (opportunity && opportunity.net > 0.01) {
    console.log('🚨 EXECUTING TRADE!');
    
    // Execute trade
    const result = await executeTrade(opportunity);
    
    if (result.success) {
      // Track profits
      totalProfit += opportunity.net;
      tradeCount++;
      
      console.log(`✅ TRADE SUCCESSFUL!`);
      console.log(`💰 This trade: $${opportunity.net.toFixed(4)}`);
      console.log(`📈 Total profit: $${totalProfit.toFixed(4)}`);
      console.log(`🔢 Trade count: ${tradeCount}`);
      
      // Notify
      await notifyProfit(opportunity);
    }
  } else {
    console.log('❌ No profitable opportunities');
  }
}, 30000);

// Initial scan
setTimeout(async () => {
  console.log('🎯 Initial complete scan...');
  await simulateArbitrage();
}, 5000);
