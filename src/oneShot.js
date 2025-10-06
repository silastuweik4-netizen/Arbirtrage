//  src/oneShot.js  – execute a single mint → SOL flash-loan
import fetch from 'node-fetch';
import { notify } from './telegram.js';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getKeypair } from './wallet.js';
import { config } from 'dotenv'; config();

const RPC_URL   = process.env.RPC_URL;
const JUP_API   = 'https://quote-api.jup.ag/v6/quote';
const conn      = new Connection(RPC_URL, 'confirmed');
const keypair   = getKeypair();

export async function executeOne(mint, amount = 1_000_000) {
  if (!mint) return;
  console.log('[ONE-SHOT]', mint, 'amount', amount);

  // 1. Jupiter quote identical-mint → SOL
  const url = `${JUP_API}?inputMint=${mint}&outputMint=So11111111111111111111111111111111111111112&amount=${amount}&slippageBps=50`;
  const res = await fetch(url);
  if (!res.ok) { console.log('Jupiter one-shot HTTP', res.status); return; }
  const data = await res.json();
  if (!data.routePlan || data.routePlan.length < 2) { console.log('No 2-hop route'); return; }

  // 2. build flash-loan tx (placeholder Solend pool)
  const tx = new Transaction().add(
    new TransactionInstruction({ keys: [], programId: new PublicKey('So1endDq2YkqhpRhqwjU2uVQtj8B5X8Jx7Mg6k8SiYo'), data: Buffer.alloc(0) }),
    ...data.routePlan.map(p => Transaction.from(Buffer.from(p.swapTransaction, 'base64')).instructions).flat()
  );
  tx.feePayer = keypair.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(keypair);

  // 3. submit Jito bundle
  const bundle = [Array.from(tx.serialize())];
  const bundleRes = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': process.env.JITO_AUTH_KEY },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [bundle] })
  });
  const { result } = await bundleRes.json();
  console.log('[ONE-SHOT] bundle landed', result);
  await notify(`✅ One-shot executed\nMint: <code>${mint}</code>\nBundle: <code>${result}</code>`);
}
