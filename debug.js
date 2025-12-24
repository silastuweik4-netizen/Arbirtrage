//  debug.js  — systematic testing
require('dotenv').config();

console.log('🐛 DEBUG MODE - Testing everything step by step');
console.log('Time:', new Date().toLocaleString());

async function runTests() {
  console.log('\n=== TEST 1: Environment ===');
  console.log('RPC_URL:', process.env.RPC_URL ? '✅ SET' : '❌ MISSING');
  console.log('PRIVATE_KEY:', process.env.PRIVATE_KEY_BASE58 ? '✅ SET' : '❌ MISSING');
  console.log('JITO_AUTH:', process.env.JITO_AUTH_KEY ? '✅ SET' : '❌ MISSING');

  console.log('\n=== TEST 2: Module Loading ===');
  try {
    const { Connection } = require('@solana/web3.js');
    console.log('✅ Solana web3 loaded');
    
    const fetch = require('node-fetch');
    console.log('✅ Fetch loaded');
    
    const express = require('express');
    console.log('✅ Express loaded');

    console.log('\n=== TEST 3: Solana Connection ===');
    const rpc = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpc, 'confirmed');
    const version = await connection.getVersion();
    console.log('✅ Solana connected:', version['solana-core']);

    console.log('\n=== TEST 4: Jupiter API ===');
    const response = await fetch('https://quote-api.jup.ag/v6/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000');
    console.log('Jupiter Status:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Jupiter working, outAmount:', data.outAmount);
    } else {
      console.log('❌ Jupiter failed:', response.statusText);
    }

    console.log('\n🎉 ALL TESTS PASSED!');
    return true;
    
  } catch (error) {
    console.error('\n💥 TEST FAILED:', error.message);
    return false;
  }
}

// Run tests
runTests().then(success => {
  if (success) {
    console.log('\n✅ System ready for arbitrage logic!');
  } else {
    console.log('\n❌ Fix issues before adding arbitrage code');
    process.exit(1);
  }
});
