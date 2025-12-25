//  exact-debug.js  — EXACT step-by-step debugging
import { config } from 'dotenv';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

config();

console.log('🧪 EXACT STEP-BY-STEP DEBUGGING');
console.log('🏊‍♂️ Exact step-by-step debugging');

// EXACT step-by-step debugging
console.log('Step 1: EXACT environment variable');
console.log('ENV exact:', process.env.PRIVATE_KEY_BASE58);
console.log('ENV length:', process.env.PRIVATE_KEY_BASE58?.length);
console.log('ENV first 10 chars:', process.env.PRIVATE_KEY_BASE58?.substring(0, 10));
console.log('ENV last 10 chars:', process.env.PRIVATE_KEY_BASE58?.substring(-10));

console.log('Step 2: EXACT base64 decode attempt');
try {
  const decoded = bs58.decode(process.env.PRIVATE_KEY_BASE58);
  console.log('✅ EXACT base58 decode successful');
  console.log('📊 EXACT decoded length:', decoded.length);
  console.log('📊 EXACT decoded bytes:', decoded);
  
  console.log('Step 3: EXACT keypair creation');
  const wallet = Keypair.fromSecretKey(decoded);
  console.log('✅ EXACT keypair creation successful');
  console.log('🏊‍♂️ EXACT wallet public key:', wallet.publicKey.toString());
  
} catch (error) {
  console.error('💥 EXACT error:', error.message);
  console.log('💡 EXACT solution: Use exact base58 format without 0x prefix');
}
