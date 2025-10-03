//  wallet.js  – base-58 edition
import { config } from 'dotenv';
config();
import { Keypair } from '@solana/web3.js';

export function getKeypair() {
  const b58 = process.env.PRIV_KEY_BASE58;
  if (!b58) throw new Error('PRIV_KEY_BASE58 missing');
  return Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        Buffer.from(
          b58, 'base58'
        ).toString('utf8')
      )
    )
  );
}
