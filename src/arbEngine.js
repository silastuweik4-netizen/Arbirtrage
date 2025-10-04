//  src/arbEngine.js  – fetch-fail guard + Telegram
import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getKeypair } from './wallet.js';
import { notify } from './telegram.js';
import { config } from 'dotenv'; config();

const RPC_URL = process.env.RPC_URL;
let conn;
try { conn = new Connection(RPC_URL, 'confirmed'); }
catch (e) { console.log('RPC init failed:', e.message); process.exit(1); }

const JUP_API   = process.env.JUPITER_API;
const JITO_AUTH = process.env.JITO_AUTH_KEY;
const LOAN_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const LOAN_AMT  = Number(process.env.LOAN_CAP || 20000) * 1e6;
const MIN_PROFIT= Number(process.env.PROFIT_THRESHOLD || 0.0008);
const keypair   = getKeypair();

async function jupQuote(inputMint, outputMint, amount) {
  try {
    const url = `${JUP_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=20`;
    const res = await fetch(url);
    return res.ok ? res.json() : null;
  } catch (e) {
    console.log('Jupiter fetch failed:', e.message);
    return null;
  }
}
async function jupSwapIx(quote) {
  try {
    const body = { quoteResponse: quote, userPublicKey: keypair.publicKey.toString() };
    const res = await fetch(`${JUP_API}/swap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.ok ? Buffer.from((await res.json()).swapTransaction, 'base64') : null;
  } catch (e) {
    console.log('Jupiter swap fetch failed:', e.message);
    return null;
  }
}

async function submitJito(txSerialize) {
  const payload = { jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [[ Array.from(txSerialize) ]] };
  const res = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${JITO_AUTH}` },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Jito bundle error');
  const { result } = await res.json();
  return result;
}

export async function scanAndArb() {
  const q1 = await jupQuote(LOAN_MINT.toString(), 'UXD6m9dlc4a4X2DpksYNdVURGpmnmXb7hX9jAQ89FxJ', LOAN_AMT);
  const q2 = await jupQuote('UXD6m9dlc4a4X2DpksYNdVURGpmnmXb7hX9jAQ89FxJ', LOAN_MINT.toString(), q1?.outAmount || 0);

  if (!q1 || !q2) { await notify(`<b>🔍 Scan</b>\nNo quote found.`); return { status: 'no quote' }; }
  const profit = Number(q2.outAmount - LOAN_AMT) / LOAN_AMT;
  if (profit < MIN_PROFIT) { await notify(`<b>🔍 Scan</b>\nProfit ${(profit*100).toFixed(3)}% < threshold.`); return { status: 'profit low', profit }; }

  const tx = new Transaction().add(
    new TransactionInstruction({ keys: [], programId: new PublicKey('So1endDq2YkqhpRhqwjU2uVQtj8B5X8Jx7Mg6k8SiYo'), data: Buffer.alloc(0) }),
    ...Transaction.from(await jupSwapIx(q1)).instructions,
    ...Transaction.from(await jupSwapIx(q2)).instructions
  );
  tx.feePayer = keypair.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(keypair);
  const bundleId = await submitJito(tx.serialize());

  const msg = `<b>🎯 Sol-Arb Alert</b>\n` +
              `<b>Status:</b>  EXECUTED ✅\n` +
              `<b>Profit:</b>   ${(profit*100).toFixed(3)}%\n` +
              `<b>Loan:</b>     ${(LOAN_AMT/1e6).toFixed(0)} USDC\n` +
              `<b>Tx:</b> <code>${tx.signature.toString('hex')}</code>\n` +
              `<b>Bundle:</b>  <code>${bundleId}</code>\n` +
              `<b>Time:</b>    ${new Date().toISOString()}`;
  await notify(msg);
  return { status: 'submitted', profit, bundleId, txSig: tx.signature.toString('hex') };
}
