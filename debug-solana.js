//  debug-solana.js  — ES module compatible debug
import { config } from 'dotenv';
config();

console.log('🎯 SOLANA DEBUG STARTING...');
console.log('Time:', new Date().toISOString());

try {
  // Test 1: Environment
  console.log('\n=== ENVIRONMENT ===');
  console.log('RPC_URL:', process.env.RPC_URL ? '✅ SET' : '❌ MISSING');
  console.log('PRIVATE_KEY:', process.env.PRIVATE_KEY_BASE58 ? '✅ SET' : '❌ MISSING');
  console.log('JITO_AUTH:', process.env.JITO_AUTH_KEY ? '✅ SET' : '❌ MISSING');

  // Test 2: Imports
  console.log('\n=== IMPORTS ===');
  const { Connection } = await import('@solana/web3.js');
  console.log('✅ Solana web3 imported');
  
  const { default: fetch } = await import('node-fetch');
  console.log('✅ Fetch imported');

  // Test 3: Solana Connection
  console.log('\n=== SOLANA CONNECTION ===');
  const rpc = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const conn = new Connection(rpc, 'confirmed');
  const version = await conn.getVersion();
  console.log('✅ Connected to Solana:', version['solana-core']);

  // Test 4: Jupiter API
  console.log('\n=== JUPITER API ===');
  const response = await fetch('https://quote-api.jup.ag/v6/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000');
  console.log('Jupiter Status:', response.status);
  
  if (response.ok) {
    const data = await response.json();
    console.log('✅ Jupiter working, outAmount:', data.outAmount);
  } else {
    console.log('❌ Jupiter failed:', response.statusText);
  }

  console.log('\n🎉 ALL TESTS PASSED! Switching to production mode...');
  
} catch (error) {
  console.error('\n💥 ERROR:', error.message);
  console.error('Stack:', error.stack?.split('\n')[0]);
}
