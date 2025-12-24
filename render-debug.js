//  render-debug.js  — forces Render to show the crash
import { config } from 'dotenv'; config();

console.log('🚀 RENDER DEBUG STARTING...');
console.log('Timestamp:', new Date().toISOString());
console.log('Node version:', process.version);
console.log('Working directory:', process.cwd());

// Force crash to surface the error
try {
  console.log('Testing environment loading...');
  
  // This will crash if .env is missing
  console.log('RPC_URL exists:', !!process.env.RPC_URL);
  console.log('PRIVATE_KEY exists:', !!process.env.PRIVATE_KEY_BASE58);
  console.log('JITO_AUTH exists:', !!process.env.JITO_AUTH_KEY);
  
  console.log('Testing module imports...');
  
  // This will crash if dependencies are missing
  const { Connection } = await import('@solana/web3.js');
  console.log('✅ Solana web3 imported');
  
  const { default: fetch } = await import('node-fetch');
  console.log('✅ Fetch imported');
  
  console.log('Testing basic functionality...');
  
  // This will crash if there's a syntax error
  const conn = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com');
  console.log('✅ Connection created');
  
  const version = await conn.getVersion();
  console.log('✅ Solana version:', version['solana-core']);
  
  console.log('🎉 ALL TESTS PASSED - Code should work!');
  
} catch (error) {
  console.error('💥 CRASH DETECTED:', error.message);
  console.error('Full error:', error);
  console.error('Stack trace:', error.stack);
  
  // Keep process alive for 30 seconds so you can see the error
  console.log('Keeping alive for 30 seconds to read error...');
  setTimeout(() => process.exit(1), 30000);
}

console.log('Debug complete - starting normal operation...');
