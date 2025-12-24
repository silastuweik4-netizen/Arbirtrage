//  start.js  — use Lite API
require('dotenv').config();

console.log('🚀 SOLANA ARB V2 STARTING...');
console.log('Time:', new Date().toLocaleString());

// Import Lite API scanner
const { scanArbitrageLite } = require('./arbitrage-lite');

// Scan every 30 seconds
setInterval(async () => {
  console.log('\n⏰ Starting Lite API arbitrage scan...');
  const opportunity = await scanArbitrageLite();
  
  if (opportunity) {
    console.log('🎯 PROFITABLE TRADE FOUND:', opportunity);
    // Execute trade logic here
  } else {
    console.log('❌ No profitable opportunities this scan');
  }
}, 30000);

// Initial scan
setTimeout(async () => {
  console.log('🎯 Initial Lite API scan starting...');
  await scanArbitrageLite();
}, 5000);
