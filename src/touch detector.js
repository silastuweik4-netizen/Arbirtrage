//  detector.js  — Step-1 read-only scanner
import { config } from 'dotenv'; config();

const JUP_API   = 'https://quote-api.jupiter.ag/v6';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT  = 'So11111111111111111111111111111111111111112';
const LOAN_AMT  = 20_000 * 1e6;        // same as bot default
const MIN_SPREAD= 0.002;               // 0.2 %

async function jupQuote(input, output, amount) {
  const url = `${JUP_API}/quote?inputMint=${input}&outputMint=${output}&amount=${amount}&slippageBps=50&showLiquidity=true`;
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

async function scanOnce() {
  const q1 = await jupQuote(USDC_MINT, SOL_MINT, LOAN_AMT);
  if (!q1) return;
  const q2 = await jupQuote(SOL_MINT, USDC_MINT, q1.outAmount);
  if (!q2) return;

  const spread = Number(q2.outAmount - LOAN_AMT) / LOAN_AMT;
  if (spread < MIN_SPREAD) return;

  const safe = Math.min(q1.safeAmount, q2.safeAmount);
  console.log(
    `[${new Date().toLocaleTimeString()}]  ` +
    `Spread: ${(spread*100).toFixed(2)}%  ` +
    `Safe loan: ${(safe/1e6).toLocaleString('en')} USDC  ` +
    `Shallowest pool: $${Math.min(q1.safeAmount, q2.safeAmount) * 3 / 1e6}`
  );
}

setInterval(scanOnce, 3_000);
scanOnce(); // first fire immediately
