// src/arbEngine.js — micro-slot sniper (Jupiter Swap v1 compatible)

import {
  Connection,
  PublicKey,
  VersionedTransaction
} from '@solana/web3.js';
import { getKeypair } from './wallet.js';
import { notify } from './telegram.js';
import { config } from 'dotenv'; config();

/* ===================== CONFIG ===================== */

const RPC_URL   = process.env.RPC_URL;
const JUP_API   = 'https://lite-api.jup.ag/swap/v1';
const JITO_AUTH = process.env.JITO_AUTH_KEY;

const LOAN_MINT = new PublicKey(
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC
);

const BASE_MINTS = [
  'So11111111111111111111111111111111111111112', // SOL
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump'
];

const LOAN_AMOUNTS = [1_000, 5_000, 20_000].map(v => v * 1e6);
const SCAN_MS      = 500;
const MIN_SPREAD  = 0.001; // 0.1%
const MIN_USD     = 25;
const MAX_IMPACT  = 0.01;  // 1%

const keypair = getKeypair();
const conn = new Connection(RPC_URL, 'confirmed');

/* ===================== JUPITER ===================== */

async function jupQuote(inputMint, outputMint, amount) {
  const url =
    `${JUP_API}/quote` +
    `?inputMint=${inputMint}` +
    `&outputMint=${outputMint}` +
    `&amount=${amount}` +
    `&slippageBps=50`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (!res.ok) return null;

    const q = await res.json();
    if (!q.routePlan || !q.outAmount) return null;

    const worstImpact = Math.max(
      ...q.routePlan.map(h =>
        Number(h.swapInfo?.priceImpactPct || 0)
      )
    );

    if (worstImpact > MAX_IMPACT) return null;

    q.safeOutAmount = Math.floor(Number(q.outAmount) * 0.7);
    q.worstImpact = worstImpact;

    return q;
  } catch {
    return null;
  }
}

/* ===================== KAMINO ===================== */

async function kaminoMaxLoan(mint) {
  const res = await fetch(
    `https://api.kamino.finance/v1/flash-loan/info/${mint}`
  );
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
    priorityFeeLamports: Math.max(
      10_000,
      Math.floor(loanAmount * 0.0001)
    )
  };

  const res = await fetch(
    'https://api.kamino.finance/v1/flash-loan',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) return null;
  const { tx } = await res.json();
  return Buffer.from(tx, 'base64');
}

/* ===================== JITO ===================== */

async function submitJito(txBytes) {
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendBundle',
    params: [[Array.from(txBytes)]]
  };

  const res = await fetch(
    'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${JITO_AUTH}`
      },
      body: JSON.stringify(payload)
    }
  );

  if (!res.ok) throw new Error('Jito failed');
  const { result } = await res.json();
  return result;
}

/* ===================== BALANCE ===================== */

async function getUsdcBalance() {
  const ata = await conn.getTokenAccountsByOwner(
    keypair.publicKey,
    { mint: LOAN_MINT }
  );
  if (!ata.value.length) return 0;
  const bal = await conn.getTokenAccountBalance(
    ata.value[0].pubkey
  );
  return Number(bal.value.amount);
}

/* ===================== SCANNER ===================== */

async function microSlotSnipe() {
  for (const baseMint of BASE_MINTS) {
    for (const loan of LOAN_AMOUNTS) {
      const q1 = await jupQuote(LOAN_MINT, baseMint, loan);
      if (!q1) continue;

      const q2 = await jupQuote(
        baseMint,
        LOAN_MINT,
        q1.outAmount
      );
      if (!q2) continue;

      const profitRaw = Number(q2.outAmount) - loan;
      const spread = profitRaw / loan;
      const profitUsd = profitRaw / 1e6;

      if (spread < MIN_SPREAD || profitUsd < MIN_USD) continue;

      console.log(
        `[ARB] ${baseMint.slice(0,4)}… ` +
        `loan=${loan/1e6} ` +
        `spread=${(spread*100).toFixed(3)}% ` +
        `profit=$${profitUsd.toFixed(2)}`
      );

      return { baseMint, loan, q1, q2, profitUsd };
    }
  }
  return null;
}

/* ===================== EXECUTOR ===================== */

export async function scanAndArb(seed = null) {
  const loan = seed
    ? seed.loan
    : Math.min(
        Number(process.env.LOAN_CAP || 20_000) * 1e6,
        await kaminoMaxLoan(LOAN_MINT)
      );

  const baseMint = seed
    ? seed.baseMint
    : BASE_MINTS[0];

  const q1 = seed
    ? seed.q1
    : await jupQuote(LOAN_MINT, baseMint, loan);

  if (!q1) return;

  const q2 = seed
    ? seed.q2
    : await jupQuote(baseMint, LOAN_MINT, q1.outAmount);

  if (!q2) return;

  const txB64 = await buildFlashTx(
    LOAN_MINT,
    baseMint,
    loan
  );
  if (!txB64) return;

  const tx = VersionedTransaction.deserialize(txB64);
  tx.sign([keypair]);

  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) return;

  const before = await getUsdcBalance();
  const bundleId = await submitJito(tx.serialize());

  await new Promise(r => setTimeout(r, 12_000));

  const after = await getUsdcBalance();
  const realised = (after - before) / 1e6;

  await notify(
    `<b>⚡ Flash-Arb Executed</b>\n` +
    `<b>Profit:</b> +${realised.toFixed(2)} USDC\n` +
    `<b>Bundle:</b> <code>${bundleId}</code>`
  );
}

/* ===================== LOOP ===================== */

setInterval(async () => {
  const seed = await microSlotSnipe();
  if (seed) await scanAndArb(seed);
}, SCAN_MS);
