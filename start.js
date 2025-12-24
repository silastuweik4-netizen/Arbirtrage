//  start.js  — bulletproof startup
require('dotenv').config();

console.log('🚀 SOLANA ARB V2 STARTING...');
console.log('Time:', new Date().toLocaleString());

// Keep alive with heartbeat
setInterval(() => {
  console.log('💓 Heartbeat:', new Date().toLocaleString());
}, 30000); // Every 30 seconds

// Simple test that can't fail
try {
  console.log('✅ Environment loaded');
  console.log('RPC_URL exists:', !!process.env.RPC_URL);
  console.log('🎯 Service is LIVE - ready to add arbitrage logic');
  
  // Add your arbitrage code here once this works
  
} catch (error) {
  console.error('💥 Error:', error.message);
  process.exit(1);
}

console.log('🎉 Service started successfully!');
