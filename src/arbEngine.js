//  src/arbEngine.js  — Kamino Flash-loan edition
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
const LOAN_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
const LOAN_AMT  = Number(process.env.LOAN_CAP || 20_000) * 1e6;
const MIN_PROFIT= Number(process.env.PROFIT_THRESHOLD || 0.0001);
const keypair   = getKeypair();

/* ---------- helper ---------- */
async function kaminoMaxLoan(mint) {
  const res = await fetch(`https://api.kamino.finance/v1/flash-loan/info/${mint}`);
  if (!res.ok) return 0;
  const { maxAmount } = await res.json();
  return Number(maxAmount);
}

/* ---------- Kamino Flash + Jupiter swaps ---------- */
async function buildFlashTx(inputMint, outputMint, loanAmount) {
  const body = {
    token:            inputMint.toString(),
    amount:           loanAmount,
    user:             keypair.publicKey.toString(),
    instructions:     'jupiter',         // Kamino builds swaps inside
    inputMint:        inputMint.toString(),
    outputMint:       outputMint.toString(),
    finalMint:        inputMint.toString(),
    slippageBps:      50,
    priorityFeeLamports: Math.max(10_000, Math.floor(loanAmount * 0.0001))
  };
  const res = await fetch('https://api.kamino.finance/v1/flash-loan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) return null;
  const { tx } = await res.json();
  return Buffer.from(tx, 'base64');   // versioned tx
}

/* ---------- Jito bundle ---------- */
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

/* ---------- USDC balance ---------- */
async function getUsdcBalance() {
  const ata = await conn.getTokenAccountsByOwner(keypair.publicKey, { mint: LOAN_MINT });
  if (ata.value.length === 0) return 0;
  const bal = await conn.getTokenAccountBalance(ata.value[0].pubkey);
  return Number(bal.value.amount);
}

/* ---------- MAIN ---------- */
export async function scanAndArb() {
  /* 1.  how big can we borrow? */
  const maxBorrow = await kaminoMaxLoan(LOAN_MINT);
  const loanAmt   = Math.min(LOAN_AMT, maxBorrow);
  if (loanAmt < 1_000_000) { await notify(`<b>🔍 Scan</b>\nKamino liquidity too low.`); return { status: 'no borrow' }; }

  /* 2.  build flash-loan + swaps + repay tx */
  const baseMint = 'So11111111111111111111111111111111111111112'; // SOL example
  const txB64    = await buildFlashTx(LOAN_MINT, baseMint, loanAmt);
  if (!txB64) { await notify(`<b>🔍 Scan</b>\nKamino flash build failed.`); return { status: 'build fail' }; }

  const { VersionedTransaction } = await import('@solana/web3.js');
  const tx = VersionedTransaction.deserialize(txB64);
  tx.sign([keypair]);

  /* 3.  balance before */
  const usdcBefore = await getUsdcBalance();

  /* 4.  simulate first */
  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) { console.log('sim fail', sim.value.logs); return { status: 'sim-fail' }; }

  /* 5.  send bundle */
  const bundleId = await submitJito(tx.serialize());

  /* 6.  wait & diff */
  await new Promise(r => setTimeout(r, 15_000));
  const usdcAfter = await getUsdcBalance();
  const realised = (usdcAfter - usdcBefore) / 1e6; // already net of Kamino fee

  /* 7.  telegram */
  const msg = `<b>🎯 Flash-Arb Alert</b>\n` +
              `<b>Status:</b>  EXECUTED ✅\n` +
              `<b>Loan:</b>     ${(loanAmt/1e6).toFixed(0)} USDC  ⬅ Kamino flash\n` +
              `<b>Realised:</b> +${realised.toFixed(2)} USDC  ⬅ after repay + fee\n` +
              `<b>Bundle:</b>  <code>${bundleId}</code>\n` +
              `<b>Time:</b>    ${new Date().toISOString()}`;
  await notify(msg);
  return { status: 'submitted', realised, bundleId };
}
