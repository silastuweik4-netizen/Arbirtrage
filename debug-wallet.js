//  debug-wallet.js  — COMPLETE wallet debugging
import { config } from 'dotenv';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

config();

console.log('🧪 COMPLETE WALLET DEBUGGING');
console.log('🏊‍♂️ Complete step-by-step debugging');

// EXACT step-by-step debugging
console.log('Step 1: Environment variable');
console.log('ENV length:', process.env.PRIVATE_KEY_BASE58?.length);
console.log('ENV first 10 chars:', process.env.PRIVATE_KEY_BASE58?.substring(0, 10));
console.log('ENV last 10 chars:', process.env.PRIVATE_KEY_BASE58?.substring(-10));

console.log('Step 2: Base58 decode attempt');
try {
  const decoded = bs58.decode(process.env.PRIVATE_KEY_BASE58);
  console.log('✅ Base58 decode successful');
  console.log('📊 Decoded length:', decoded.length);
  console.log('🏊‍♂️ Keypair creation successful');
  
} catch (error) {
  console.error('💥 EXACT error:', error.message);
  console.log('💡 EXACT solution: Use exact base58 format without 0x prefix');
}
