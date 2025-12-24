//  brutalDebug.js  — exposes EVERYTHING that could be broken
import { config } from 'dotenv'; config();

console.log('🚨 BRUTE-FORCE DIAGNOSTIC STARTING...\n');

// Test each API individually with raw HTTP
const testAPIs = async () => {
  console.log('=== TESTING JUPITER API ===');
  
  // Test 1: Raw Jupiter quote with manual HTTP
  try {
    console.log('📍 Testing Jupiter endpoint...');
    const response = await fetch('https://quote-api.jupiter.ag/v6/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000&slippageBps=50');
    
    console.log('Jupiter Status:', response.status);
    console.log('Jupiter Headers:', Object.fromEntries(response.headers.entries()));
    
    if (response.ok) {
      const data = await response.json();
      console.log('Jupiter Response Keys:', Object.keys(data));
      console.log('Jupiter outAmount:', data.outAmount);
    } else {
      const errorText = await response.text();
      console.log('Jupiter Error Body:', errorText.substring(0, 200));
    }
  } catch (e) {
    console.log('Jupiter CRASHED:', e.message);
  }

  console.log('\n=== TESTING KAMINO API ===');
  
  // Test 2: Raw Kamino flash loan info
  try {
    console.log('📍 Testing Kamino endpoint...');
    const kaminoResponse = await fetch('https://api.kamino.finance/v1/flash-loan/info/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    
    console.log('Kamino Status:', kaminoResponse.status);
    console.log('Kamino Headers:', Object.fromEntries(kaminoResponse.headers.entries()));
    
    if (kaminoResponse.ok) {
      const kaminoData = await kaminoResponse.json();
      console.log('Kamino Response:', kaminoData);
    } else {
      const errorText = await kaminoResponse.text();
      console.log('Kamino Error Body:', errorText.substring(0, 200));
    }
  } catch (e) {
    console.log('Kamino CRASHED:', e.message);
  }

  console.log('\n=== TESTING JITO API ===');
  
  // Test 3: Raw Jito bundle endpoint
  try {
    console.log('📍 Testing Jito endpoint...');
    const jitoResponse = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [[]] })
    });
    
    console.log('Jito Status:', jitoResponse.status);
    console.log('Jito Headers:', Object.fromEntries(jitoResponse.headers.entries()));
    
    if (jitoResponse.ok) {
      const jitoData = await jitoResponse.json();
      console.log('Jito Response:', jitoData);
    } else {
      const errorText = await jitoResponse.text();
      console.log('Jito Error Body:', errorText.substring(0, 200));
    }
  } catch (e) {
    console.log('Jito CRASHED:', e.message);
  }
};

// Test Solana RPC
const testRPC = async () => {
  console.log('\n=== TESTING SOLANA RPC ===');
  
  try {
    console.log('📍 Testing Solana connection...');
    const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    console.log('Using RPC:', rpcUrl);
    
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getHealth'
      })
    });
    
    console.log('RPC Status:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('RPC Health:', data);
    } else {
      const errorText = await response.text();
      console.log('RPC Error:', errorText.substring(0, 200));
    }
  } catch (e) {
    console.log('RPC CRASHED:', e.message);
  }
};

// Test with different Jupiter endpoints
const testJupiterEndpoints = async () => {
  console.log('\n=== TESTING JUPITER ENDPOINT VARIATIONS ===');
  
  const endpoints = [
    'https://quote-api.jup.ag/v6',
    'https://quote-api.jupiter.ag/v6',
    'https://api.jup.ag/quote/v6'
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`\n📍 Testing: ${endpoint}`);
      const response = await fetch(`${endpoint}/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000`);
      
      console.log(`Status: ${response.status}`);
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ SUCCESS - Keys: ${Object.keys(data).join(', ')}`);
        break; // Stop testing once we find a working endpoint
      } else {
        console.log(`❌ FAILED - ${response.statusText}`);
      }
    } catch (e) {
      console.log(`💥 CRASHED - ${e.message}`);
    }
  }
};

// Test with curl equivalent (most basic)
const testBasicHTTP = async () => {
  console.log('\n=== TESTING BASIC HTTP (curl equivalent) ===');
  
  try {
    console.log('📍 Testing with node-fetch directly...');
    
    // Most basic test - like curl
    const response = await fetch('https://quote-api.jup.ag/v6/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000');
    
    console.log('Basic HTTP Status:', response.status);
    console.log('Basic HTTP OK:', response.ok);
    
    const text = await response.text();
    console.log('Response length:', text.length);
    console.log('First 200 chars:', text.substring(0, 200));
    
  } catch (e) {
    console.log('Basic HTTP CRASHED:', e.message);
    console.log('Full error:', e);
  }
};

// Run everything
const runDiagnostics = async () => {
  console.log('🎯 Starting brutal diagnostics...\n');
  
  // Check environment
  console.log('=== ENVIRONMENT CHECK ===');
  console.log('RPC_URL:', process.env.RPC_URL ? 'Set' : 'NOT SET');
  console.log('JITO_AUTH_KEY:', process.env.JITO_AUTH_KEY ? 'Set' : 'NOT SET');
  console.log('NODE_VERSION:', process.version);
  console.log('TIMESTAMP:', new Date().toISOString());
  
  await testBasicHTTP();
  await testJupiterEndpoints();
  await testAPIs();
  await testRPC();
  
  console.log('\n🚨 DIAGNOSTICS COMPLETE');
};

runDiagnostics().catch(console.error);
