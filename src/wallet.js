import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export function getKeypair() {
  const key = process.env.PRIVATE_KEY_BASE58;
  if (!key) throw new Error('PRIVATE_KEY_BASE58 missing');
  return Keypair.fromSecretKey(bs58.decode(key.trim()));
}
