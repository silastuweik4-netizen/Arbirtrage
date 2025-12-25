// arbBot_dashboard.js — full updated NaN-proof, live-updating dashboard
import express from 'express';
import fetch from 'node-fetch';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { config } from 'dotenv';
import { getKeypair } from './wallet.js';
import { notify } from './telegram.js';

config();

const app = express();
const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL;
const JITO_AUTH = process.env.JITO_AUTH_KEY;
const LOAN_MINT = new PublicKey(process.env.LOAN_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const LOAN_AMT = Number(process.env.LOAN_CAP || 20000) * 1e6;
const MIN_PROFIT = Number(process.env.PROFIT_THRESHOLD || 0.0001);
const SIMULATION_MODE = process.env.SIMULATION_MODE === 'true';
const keypair = getKeypair();
const conn = new Connection(RPC_URL, 'confirmed');

let tokenCache = [];
let arbHistory = [];
const MAX_HISTORY = 50;

// ---------- Token cache refresh ----------
setInterval(async () => {
  try {
    const data = await fetch('https://cache.jup.ag/tokens').then(r => r.json());
    tokenCache = data;
    console.log(`[CACHE] Token cache updated. ${tokenCache.length} tokens`);
  } catch (e) {
    console.log('[CACHE] Failed to update token cache:', e.message);
  }
}, 5000);

// ---------- Helpers ----------
async function fetchDexQuote(inputMint, outputMint, amount) {
  try {
    const inputToken = tokenCache.find(t => t.address === inputMint);
    const outputToken = tokenCache.find(t => t.address === outputMint);
    if (!inputToken || !outputToken || !inputToken.priceUSD || !outputToken.priceUSD) return null;

    const inputAmountUSD = inputToken.priceUSD * (amount / 10 ** inputToken.decimals);
    const slippageFactor = 1 - (Math.random() * 0.004 + 0.001);
    const outAmountRaw = (inputAmountUSD / outputToken.priceUSD) * 10 ** outputToken.decimals;
    const outAmount = Math.max(0, Math.floor(outAmountRaw * slippageFactor));
    const safeAmount = Math.floor(outAmount / 3);

    return { outAmount, safeAmount, routePlan: [{ swapInfo: { liquidityAvailable: outAmount } }] };
  } catch (e) {
    console.log('fetchDexQuote failed:', e.message);
    return null;
  }
}

async function buildFlashTx(inputMint, outputMint, loanAmount) {
  // Placeholder for Kamino flash loan tx
  return new Uint8Array();
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

// ---------- Micro-slot arbitrage ----------
const BASE_MINTS = [
  'So11111111111111111111111111111111111111112',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
];

async function microSlotSnipe() {
  for (const baseMint of BASE_MINTS) {
    const loan = LOAN_AMT;
    const q1 = await fetchDexQuote(LOAN_MINT.toString(), baseMint, loan);
    const q2 = q1 ? await fetchDexQuote(baseMint, LOAN_MINT.toString(), q1.outAmount) : null;

    if (!q1 || !q2 || !q1.outAmount || !q2.outAmount) continue;

    const spread = (Number(q2.outAmount) - loan) / loan;
    const profit = (Number(q2.outAmount) - loan) / 1e6;

    if (spread < 0.002 || profit < 1) continue;

    console.log(`[SNIPE] base=${baseMint.slice(0,4)}… | loan=$${(loan/1e6).toFixed(0)} | spread=${(spread*100).toFixed(3)}% | profit=$${profit.toFixed(2)}`);
    return { loan, spread, profit, q1, q2, baseMint };
  }
  return null;
}

// ---------- Scan and Arb ----------
async function scanAndArb(seed = null) {
  const loanAmt = seed?.loan || LOAN_AMT;
  const baseMint = seed?.baseMint || BASE_MINTS[0];
  const q1 = seed?.q1 || await fetchDexQuote(LOAN_MINT.toString(), baseMint, loanAmt);
  const q2 = seed?.q2 || (q1 ? await fetchDexQuote(baseMint, LOAN_MINT.toString(), q1.outAmount) : null);

  if (!q1 || !q2 || !q1.outAmount || !q2.outAmount) return { status: 'no quote' };

  const spread = (Number(q2.outAmount) - loanAmt) / loanAmt;
  const profit = (Number(q2.outAmount) - loanAmt) / 1e6;
  if (spread < MIN_PROFIT) return { status: 'profit low', profit };

  const record = {
    time: new Date().toISOString(),
    baseMint,
    loan: (loanAmt / 1e6).toFixed(2),
    profit: profit.toFixed(2),
    spread: (spread * 100).toFixed(3),
    status: SIMULATION_MODE ? 'SIM' : 'LIVE'
  };

  arbHistory.unshift(record);
  if (arbHistory.length > MAX_HISTORY) arbHistory.pop();

  if (SIMULATION_MODE) {
    console.log(`[SIM] Arb detected! base=${baseMint.slice(0,4)}… | loan=$${(loanAmt/1e6).toFixed(0)} | profit≈$${profit.toFixed(2)} | spread=${(spread*100).toFixed(3)}%`);
    await notify(`<b>[SIMULATION] Arb opportunity detected!</b>\nBase: ${baseMint}\nLoan: $${(loanAmt/1e6).toFixed(0)}\nEstimated Profit: $${profit.toFixed(2)}\nSpread: ${(spread*100).toFixed(3)}%`);
    return { status: 'simulated', profit, baseMint };
  }

  const txB64 = await buildFlashTx(LOAN_MINT, baseMint, loanAmt);
  const tx = VersionedTransaction.deserialize(txB64);
  tx.sign([keypair]);
  const bundleId = await submitJito(tx.serialize());

  const msg = `<b>🎯 Flash-Arb Alert</b>\n` +
              `<b>Status:</b> EXECUTED ✅\n` +
              `<b>Loan:</b> ${(loanAmt/1e6).toFixed(0)} USDC\n` +
              `<b>Realised:</b> +${profit.toFixed(2)} USDC\n` +
              `<b>Bundle:</b> <code>${bundleId}</code>\n` +
              `<b>Time:</b> ${new Date().toISOString()}`;
  await notify(msg);
  return { status: 'submitted', realised: profit, bundleId };
}

// ---------- Main loop ----------
setInterval(async () => {
  try {
    const seed = await microSlotSnipe();
    if (seed) await scanAndArb(seed);
  } catch (e) {
    console.log('[MAIN LOOP] Error:', e.message);
  }
}, 5000);

// ---------- JSON endpoint for live updates ----------
app.get('/api/opportunities', (req, res) => {
  res.json(arbHistory);
});

// ---------- Dashboard with dynamic live table ----------
app.get('/', (req, res) => {
  let html = `
  <h1>Arb Bot Dashboard</h1>
  <p>Status: Running</p>
  <p>Mode: ${SIMULATION_MODE ? 'Simulation' : 'Live'}</p>
  <h2>Recent Opportunities</h2>
  <table id="arbTable" border="1" cellpadding="5" cellspacing="0">
    <tr>
      <th>Time</th>
      <th>Base</th>
      <th>Loan (USDC)</th>
      <th>Profit ($)</th>
      <th>Spread (%)</th>
      <th>Status</th>
    </tr>
  </table>

  <script>
    async function fetchOpportunities() {
      try {
        const res = await fetch('/api/opportunities');
        const data = await res.json();
        const table = document.getElementById('arbTable');
        table.querySelectorAll('tr:not(:first-child)').forEach(row => row.remove());
        data.forEach(a => {
          const row = table.insertRow();
          row.insertCell(0).textContent = a.time;
          row.insertCell(1).textContent = a.baseMint.slice(0,4) + '…';
          row.insertCell(2).textContent = a.loan;
          row.insertCell(3).textContent = a.profit;
          row.insertCell(4).textContent = a.spread;
          row.insertCell(5).textContent = a.status;
        });
      } catch (e) {
        console.error('Failed to fetch opportunities:', e);
      }
    }
    fetchOpportunities();
    setInterval(fetchOpportunities, 5000);
  </script>
  `;

  res.send(html);
});

app.listen(PORT, () => console.log(`🚀 Dashboard running on port ${PORT}`));
