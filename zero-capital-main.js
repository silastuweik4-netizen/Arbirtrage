//  zero-capital-main.js  — FIXED private key format
import { config } from 'dotenv';
import { ZeroCapitalFlashEngine } from './zero-capital-engine.js';
import { getRenderSafePrices } from './render-safe-prices.js';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

config();

console.log('🚀 ZERO-CAPITAL KAMINO FLASH LOAN BOT - RENDER SAFE');
console.log('💰 Using: $0 of your money (100% borrowed)');
console.log('🏊‍♂️ Rule: 1/3 of shallowest pool liquidity');

// CRITICAL: Proper private key format
if (!process.env.PRIVATE_KEY_BASE58) {
  console.error('❌ PRIVATE_KEY_BASE58 not found in environment variables');
  console.log('💡 Please set: PRIVATE_KEY_BASE58=your_private_key_base58');
  process.exit(1);
}

// FIXED: Proper private key format
try {
  const wallet = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY_BASE58));
  
  console.log('✅ Wallet initialized successfully');
  console.log('🏊‍♂️ Wallet public key:', wallet.publicKey.toString());
  
  // Initialize zero-capital engine
  const engine = new ZeroCapitalFlashEngine(wallet, process.env.RPC_URL || 'https://api.mainnet-beta.solana.com');
  
  // Zero-capital scanning (no money required!)
  setInterval(async () => {
    console.log('\n⏰ Starting ZERO-CAPITAL Kamino flash loan scan...');
    console.log('💰 Using: $0 of your money (100% borrowed)');
    console.log('🏊‍♂️ Rule: 1/3 of shallowest pool liquidity');
    
    const result = await engine.executeZeroCapitalArbitrage();
    
    if (result && result.isZeroCapital) {
      console.log('🎯 ZERO-CAPITAL KAMINO FLASH LOAN EXECUTED ON-CHAIN!');
      console.log(`💰 Zero-capital profit: $${result.profit.toFixed(4)}`);
      console.log(`🏊‍♂️ Zero-capital amount: ${(result.amount/1e6).toLocaleString()} USDC`);
      console.log(`🔗 On-chain signature: ${result.signature}`);
      console.log(`🏊‍♂️ Pool category: ${result.shallowPool?.category}`);
    } else {
      console.log('❌ No profitable zero-capital opportunities');
    }
  }, 30000);
  
  // Initial zero-capital scan
  setTimeout(async () => {
    console.log('🎯 Initial zero-capital Kamino scan...');
    await engine.executeZeroCapitalArbitrage();
  }, 5000);
  
} catch (error) {
  console.error('💥 Wallet initialization failed:', error.message);
  console.log('💡 Error: Private key format is incorrect');
  console.log('💡 Solution: Use base58 format without 0x prefix');
  process.exit(1);
}
