//  wallet.js  – base-58 fix
import { config } from 'dotenv';
config();
import { Keypair } from '@solana/web3.js';
import base58 from 'bs58';   // ← add this tiny helper

export function getKeypair() {
  const b58 = process.env.PRIV_KEY_BASE58;
  if (!b58) throw new Error('PRIV_KEY_BASE58 missing');
  return Keypair.fromSecretKey(base58.decode(b58)); // real decode
}
