// zero-capital-main.js — Render-safe private key handling (FINAL)
import { config } from 'dotenv';
import { ZeroCapitalFlashEngine } from './zero-capital-engine.js';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

config();

console.log('🚀 ZERO-CAPITAL KAMINO FLASH LOAN BOT - RENDER SAFE');
console.log('💰 Using: $0 of your money (100% borrowed)');
console.log('🏊‍♂️ Rule: 1/3 of shallowest pool liquidity');

// ─────────────────────────────────────────────────────────────
// ENV VALIDATION
// ─────────────────────────────────────────────────────────────
if (!process.env.PRIVATE_KEY_BASE58) {
  console.error('❌ PRIVATE_KEY_BASE58 not found in environment variables');
  console.log('💡 Set it in Render → Environment → PRIVATE_KEY_BASE58');
  process.exit(1);
}

if (!process.env.RPC_URL) {
  console.warn('⚠️ RPC_URL not set, using public mainnet RPC');
}

// ─────────────────────────────────────────────────────────────
// WALLET INITIALIZATION (RENDER-SAFE)
// ─────────────────────────────────────────────────────────────
let wallet;

try {
  const decodedKey = bs58.decode(
    process.env.PRIVATE_KEY_BASE58.trim() // 🔑 CRITICAL FIX
  );

  if (decodedKey.length !== 64) {
    throw new Error(`Invalid secret key length: ${decodedKey.length}`);
  }

  wallet = Keypair.fromSecretKey(decodedKey);

  console.log('✅ Wallet initialized successfully');
  console.log('🏦 Wallet public key:', wallet.publicKey.toString());

} catch (error) {
  console.error('💥 Wallet initialization failed:', error.message);
  console.log('💡 Error: Private key format is incorrect');
  console.log('💡 Solution: Use base58 format without 0x prefix');
  console.log('💡 Also ensure no quotes, spaces, or newlines in Render env vars');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// ENGINE INITIALIZATION
// ─────────────────────────────────────────────────────────────
const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const engine = new ZeroCapitalFlashEngine(wallet, rpcUrl);

// ─────────────────────────────────────────────────────────────
// ZERO-CAPITAL SCAN LOOP
// ─────────────────────────────────────────────────────────────
setInterval(async () => {
  console.log('\n⏰ Starting ZERO-CAPITAL Kamino flash loan scan...');
  console.log('💰 Using: $0 of your money (100% borrowed)');
  console.log('🏊‍♂️ Rule: 1/3 of shallowest pool liquidity');

  const result = await engine.executeZeroCapitalArbitrage();

  if (result && result.isZeroCapital) {
    console.log('🎯 ZERO-CAPITAL KAMINO FLASH LOAN EXECUTED ON-CHAIN!');
    console.log(`💰 Zero-capital profit: $${result.profit.toFixed(4)}`);
    console.log(`🏊‍♂️ Amount borrowed: ${(result.amount / 1e6).toLocaleString()} USDC`);
    console.log(`🔗 Signature: ${result.signature}`);
    console.log(`🏊‍♂️ Pool category: ${result.shallowPool?.category}`);
  } else {
    console.log('❌ No profitable zero-capital opportunities');
  }

}, 30_000);

// ─────────────────────────────────────────────────────────────
// INITIAL BOOT SCAN
// ─────────────────────────────────────────────────────────────
setTimeout(async () => {
  console.log('🎯 Initial zero-capital Kamino scan...');
  await engine.executeZeroCapitalArbitrage();
}, 5_000);
