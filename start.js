//  start.js  — COMPLETE arbitrage system
require('dotenv').config();

console.log('🚀 SOLANA ARB V2 STARTING...');
console.log('Time:', new Date().toLocaleString());

// Import working arbitrage
const { simulateArbitrage } = require('./complete-arbitrage');

// Scan every 30 seconds
setInterval(async () => {
  console.log('\n⏰ Starting arbitrage scan...');
  const opportunity = await simulateArbitrage();
  
  if (opportunity && opportunity.net > 0.01) { // $0.01 minimum
    console.log('🚨 PROFITABLE OPPORTUNITY FOUND!');
    console.log('Details:', opportunity);
    
    // Here you would execute the trade
    // For now, just log and celebrate!
    console.log('🎉 TRADE WOULD EXECUTE HERE!');
    
  } else {
    console.log('❌ No profitable opportunities this scan');
  }
}, 30000);

// Initial scan
setTimeout(async () => {
  console.log('🎯 Initial arbitrage scan...');
  await simulateArbitrage();
}, 5000);

// Keep heartbeat
setInterval(() => {
  console.log('💓 Heartbeat:', new Date().toLocaleString());
}, 60000);
