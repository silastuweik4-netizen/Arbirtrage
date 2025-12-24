//  start.js  — add arbitrage scanning
require('dotenv').config();

console.log('🚀 SOLANA ARB V2 STARTING...');
console.log('Time:', new Date().toLocaleString());

// Import arbitrage scanner
const { scanArbitrage } = require('./arbitrage');

// Scan every 30 seconds
setInterval(async () => {
  console.log('\n⏰ Starting arbitrage scan...');
  const opportunity = await scanArbitrage();
  
  if (opportunity) {
    console.log('🎯 PROFITABLE TRADE FOUND:', opportunity);
    // Here you would execute the trade
  } else {
    console.log('❌ No profitable opportunities this scan');
  }
}, 30000); // Every 30 seconds

// Initial scan
setTimeout(async () => {
  console.log('🎯 Initial scan starting...');
  await scanArbitrage();
}, 5000); // Start first scan after 5 seconds

// Keep heartbeat
setInterval(() => {
  console.log('💓 Heartbeat:', new Date().toLocaleString());
}, 60000); // Every minute
