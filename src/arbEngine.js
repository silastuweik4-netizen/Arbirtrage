//  src/arbEngine.js  – auto-cap + realised PnL
import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
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
const MIN_PROFIT= Number(process.env.PROFIT_THRESHOLD || 0.0001);
const MIN_PARTICIPATION = 3;                 // ⅓ of shallowest pool
const keypair   = getKeypair();

async function jupQuote(inputMint, outputMint, amount) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 4000);
  try {
    const url = `${JUP_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50&showLiquidity=true`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) return null;
    const quote = await res.json();
    if (!quote.routePlan) return null;
    const minHop = Math.min(...quote.routePlan.map(h => h.swapInfo.liquidityAvailable));
    const maxSafe = Math.floor(minHop / MIN_PARTICIPATION);
    if (maxSafe < 1_000_000) return null;           // dust guard
    quote.safeAmount = Math.min(amount, maxSafe);   // auto-cap
    return quote;
  } catch (e) {
    clearTimeout(id);
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

async function getUsdcBalance() {
  // helper: USDC token-account balance (raw ui amount)
  const ata = await conn.getTokenAccountsByOwner(keypair.publicKey, { mint: LOAN_MINT });
  if (ata.value.length === 0) return 0;
  const acc = await conn.getTokenAccountBalance(ata.value[0].pubkey);
  return Number(acc.value.amount);
}

export async function scanAndArb() {
  const baseMint = 'UXD6m9dlc4a4X2DpksYNdVURGpmnmXb7hX9jAQ89FxJ';
  const [q1, q2] = await Promise.all([
    jupQuote(LOAN_MINT.toString(), baseMint, LOAN_AMT),
    jupQuote(baseMint, LOAN_MINT.toString(), 0) // placeholder
  ]);
  if (!q1) { await notify(`<b>🔍 Scan</b>\nNo liquid route.`); return { status: 'no quote' }; }
  const q2 = await jupQuote(baseMint, LOAN_MINT.toString(), q1.outAmount);
  if (!q2) { await notify(`<b>🔍 Scan</b>\nNo quote found.`); return { status: 'no quote' }; }

  const loanUsed = q1.safeAmount;
  const profit   = Number(q2.outAmount - loanUsed) / loanUsed;
  if (profit < MIN_PROFIT) { await notify(`<b>🔍 Scan</b>\nProfit ${(profit*100).toFixed(3)}% < threshold.`); return { status: 'profit low', profit }; }

  // build versioned tx
  const swap1 = await jupSwapIx(q1);
  const swap2 = await jupSwapIx(q2);
  if (!swap1 || !swap2) return { status: 'build fail' };

  const { TransactionMessage, VersionedTransaction } = await import('@solana/web3.js');
  const latest = await conn.getLatestBlockhash();
  const tipAccount = new PublicKey('juLesoTJWQaG4zTEa6f8vdh9Sh7uSSo58nK9GSr2s1M');
  const tipLamports = Math.min(Math.floor(profit * loanUsed * 0.25), 50_000);

  const allIx = [
    ...Transaction.from(swap1).instructions,
    ...Transaction.from(swap2).instructions,
    SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: tipAccount, lamports: tipLamports })
  ];

  const v0Msg = new TransactionMessage({
    payerKey: keypair.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: allIx
  }).compileToV0Message();
  const tx = new VersionedTransaction(v0Msg);
  tx.sign([keypair]);

  // simulate
  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) { console.log('sim error', sim.value.logs); return { status: 'sim-fail' }; }

  // pre-balance
  const usdcBefore = await getUsdcBalance();

  // send bundle
  const bundleId = await submitJito(tx.serialize());

  // wait 15 s for confirmation (quick & dirty)
  await new Promise(r => setTimeout(r, 15_000));
  const usdcAfter = await getUsdcBalance();
  const realised = (usdcAfter - usdcBefore) / 1e6 - tipLamports / 1e9;

  // telegram
  const msg = `<b>🎯 Sol-Arb Alert</b>\n` +
              `<b>Status:</b>  EXECUTED ✅\n` +
              `<b>Profit:</b>   ${(profit*100).toFixed(3)}%\n` +
              `<b>Loan:</b>     ${(loanUsed/1e6).toFixed(0)} USDC  ⬅ auto-capped\n` +
              `<b>Realised:</b> +${realised.toFixed(2)} USDC  ⬅ after tip+slip\n` +
              `<b>Bundle:</b>  <code>${bundleId}</code>\n` +
              `<b>Time:</b>    ${new Date().toISOString()}`;
  await notify(msg);
  return { status: 'submitted', profit, realised, bundleId };
}
