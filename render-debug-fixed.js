//  render-debug-fixed.js  — ES module compatible version
import { config } from 'dotenv'; 
import { fileURLToPath } from 'url';
import { dirname } from 'path';

config();

// ES module way to get __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 RENDER DEBUG STARTING...');
console.log('Timestamp:', new Date().toISOString());
console.log('Node version:', process.version);
console.log('Working directory:', process.cwd());
console.log('File:', __filename);
console.log('Directory:', __dirname);
console.log('Process ID:', process.pid);
console.log('Arguments:', process.argv);

// Test environment variables
console.log('\n=== ENVIRONMENT TEST ===');
console.log('RPC_URL exists:', !!process.env.RPC_URL);
console.log('PRIVATE_KEY_BASE58 exists:', !!process.env.PRIVATE_KEY_BASE58);
console.log('JITO_AUTH_KEY exists:', !!process.env.JITO_AUTH_KEY);
console.log('BOT_TOKEN exists:', !!process.env.BOT_TOKEN);
console.log('CHAT_ID exists:', !!process.env.CHAT_ID);

// Test imports
try {
  console.log('\n=== MODULE IMPORT TEST ===');
  const { Connection } = await import('@solana/web3.js');
  console.log('✅ Solana web3 imported successfully');
  
  const { default: fetch } = await import('node-fetch');
  console.log('✅ node-fetch imported successfully');
  
  // Test basic functionality
  console.log('\n=== FUNCTIONALITY TEST ===');
  const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  console.log('Using RPC:', rpcUrl);
  
  const conn = new Connection(rpcUrl, 'confirmed');
  console.log('✅ Connection created');
  
  const version = await conn.getVersion();
  console.log('✅ Solana version:', version['solana-core']);
  
  console.log('\n🎉 ALL TESTS PASSED - Your code should work!');
  
  // Test Jupiter API
  console.log('\n=== JUPITER API TEST ===');
  const jupResponse = await fetch('https://quote-api.jup.ag/v6/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000');
  console.log('Jupiter API Status:', jupResponse.status);
  
  if (jupResponse.ok) {
    const data = await jupResponse.json();
    console.log('✅ Jupiter API working - outAmount:', data.outAmount);
  } else {
    console.log('❌ Jupiter API failed:', jupResponse.statusText);
  }
  
  console.log('\n🎯 DEBUG COMPLETE - App should start now!');
  
} catch (error) {
  console.error('\n💥 CRASH DETECTED:', error.message);
  console.error('Stack trace:', error.stack);
  
  // Keep alive to read error
  console.log('\nKeeping alive for 30 seconds to read error...');
  setTimeout(() => process.exit(1), 30000);
}
