//  src/arbEngine.js  — fixed, complete (Dec 12-16 settings)
import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { getKeypair } from './wallet.js';
import { notify } from './telegram.js';
import { config } from 'dotenv'; config();

const RPC_URL   = process.env.RPC_URL;
const JUP_API   = 'https://quote-api.jupiter.ag/v6';
const JITO_AUTH = process.env.JITO_AUTH_KEY;
const LOAN_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const LOAN_AMT  = Number(process.env.LOAN_CAP || 20_000) * 1e6;
const MIN_PROFIT= Number(process.env.PROFIT_THRESHOLD || 0.0005); // 0.05 %
const keypair   = getKeypair();

const BASE_MINT = 'So11111111111111111111111111111111111111112'; // SOL only (Dec period)
const MIN_LIQ   = 10_000; // $10 k floor (Dec period)
const POLL_MS   = 15_000; // 15 s poll (Dec period)

let conn;
try { conn = new Connection(RPC_URL, 'confirmed'); } catch (e) { console.log('RPC init failed:', e.message); process.exit(1); }

/* ---------- helpers ---------- */
async function jupQuote(inputMint, outputMint, amount) {
  const url = `${JUP_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50&showLiquidity=true`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    if (!res.ok) return null;
    const q = await res.json();
    if (!q.routePlan) return null;
    const minHop = Math.min(...q.routePlan.map(h => h.swapInfo.liquidityAvailable));
    q.safeAmount = Math.floor(minHop / 3);
    return q;
  } catch { return null; }
}

async function kaminoMaxLoan(mint) {
  const res = await fetch(`https://api.kamino.finance/v1/flash-loan/info/${mint}`);
  if (!res.ok) return 0;
  const { maxAmount } = await res.json();
  return Number(maxAmount);
}

async function buildFlashTx(inputMint, outputMint, loanAmount) {
  const body = {
    token: inputMint.toString(),
    amount: loanAmount,
    user: keypair.publicKey.toString(),
    instructions: 'jupiter',
    inputMint: inputMint.toString(),
    outputMint: outputMint.toString(),
    finalMint: inputMint.toString(),
    slippageBps: 50,
    priorityFeeLamports: Math.max(10_000, Math.floor(loanAmount * 0.0001))
  };
  const res = await fetch('https://api.kamino.finance/v1/flash-loan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) return null;
  const { tx } = await res.json();
  return Buffer.from(tx, 'base64');
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
  const ata = await conn.getTokenAccountsByOwner(keypair.publicKey, { mint: LOAN_MINT });
  if (ata.value.length === 0) return 0;
  const bal = await conn.getTokenAccountBalance(ata.value[0].pubkey);
  return Number(bal.value.amount);
}

/* ---------- 15 s loop (Dec 12-16 settings) ---------- */
setInterval(async () => {
  const loanAmt = Math.min(LOAN_AMT, await kaminoMaxLoan(LOAN_MINT));
  const q1 = await jupQuote(LOAN_MINT, BASE_MINT, loanAmt);
  if (!q1) return;
  const q2 = await jupQuote(BASE_MINT, LOAN_MINT, q1.outAmount);
  if (!q2) return;

  const spread = Number(q2.outAmount - loanAmt) / loanAmt;
  const profit = Number(q2.outAmount - loanAmt) / 1e6;
  const minHop = Math.min(...q1.routePlan.map(h => h.swapInfo.liquidityAvailable),
                          ...q2.routePlan.map(h => h.swapInfo.liquidityAvailable));
  const safe   = Math.floor(minHop / 3);

  if (spread < MIN_PROFIT || minHop < MIN_LIQ * 1e6) return;

  console.log(`[DEC]  loan=$${loanAmt/1e6}  spread=${(spread*100).toFixed(2)}%  profit=$${profit.toFixed(2)}  safe=$${safe/1e6}`);
  await scanAndArb();   // existing engine
}, POLL_MS);

export async function scanAndArb() {
  const loanAmt = Math.min(LOAN_AMT, await kaminoMaxLoan(LOAN_MINT));
  const baseMint = 'So11111111111111111111111111111111111111112';
  const q1 = await jupQuote(LOAN_MINT, baseMint, loanAmt);
  if (!q1) return { status: 'no quote' };
  const q2 = await jupQuote(BASE_MINT, LOAN_MINT, q1.outAmount);
  if (!q2) return { status: 'no quote' };

  const spread = Number(q2.outAmount - loanAmt) / loanAmt;
  const profit = Number(q2.outAmount - loanAmt) / 1e6;
  if (spread < MIN_PROFIT) return { status: 'profit low', profit };

  const txB64 = await buildFlashTx(LOAN_MINT, baseMint, loanAmt);
  if (!txB64) return { status: 'build fail' };

  const { VersionedTransaction } = await import('@solana/web3.js');
  const tx = VersionedTransaction.deserialize(txB64);
  tx.sign([keypair]);

  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) { console.log('sim error', sim.value.logs); return { status: 'sim-fail' }; }

  const usdcBefore = await getUsdcBalance();
  const bundleId = await submitJito(tx.serialize());
  await new Promise(r => setTimeout(r, 15_000));
  const usdcAfter = await getUsdcBalance();
  const realised = (usdcAfter - usdcBefore) / 1e6;

  const msg = `<b>🎯 Flash-Arb Alert</b>\n` +
              `<b>Status:</b>  EXECUTED ✅\n` +
              `<b>Loan:</b>     ${(loanAmt/1e6).toFixed(0)} USDC  ⬅ Kamino flash\n` +
              `<b>Realised:</b> +${realised.toFixed(2)} USDC  ⬅ after repay + fee\n` +
              `<b>Bundle:</b>  <code>${bundleId}</code>\n` +
              `<b>Time:</b>    ${new Date().toISOString()}`;
  await notify(msg);
  return { status: 'submitted', realised, bundleId };
}
