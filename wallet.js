import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Load your Solana private key from environment
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error('Set PRIVATE_KEY in .env');

export function getKeypair() {
  const decoded = bs58.decode(PRIVATE_KEY);
  return Keypair.fromSecretKey(decoded);
}
