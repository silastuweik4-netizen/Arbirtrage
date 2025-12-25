import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import bs58 from 'bs58';

const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
export const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));

const RPC_URL = process.env.RPC_URL;
export const conn = new Connection(RPC_URL, 'confirmed');

export async function getTokenBalance(mint) {
  const ata = await conn.getTokenAccountsByOwner(keypair.publicKey, { mint: new PublicKey(mint) });
  if (ata.value.length === 0) return 0;
  const bal = await conn.getTokenAccountBalance(ata.value[0].pubkey);
  return Number(bal.value.amount);
    }
