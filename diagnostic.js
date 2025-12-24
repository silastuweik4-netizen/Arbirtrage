//  diagnostic.js  — live peek into both scanners
import { config } from 'dotenv'; config();

const JUP_API   = 'https://quote-api.jupiter.ag/v6';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT  = 'So11111111111111111111111111111111111111112';
const LOAN      = 20_000 * 1e6;
const MIN_BPS   = 0.2 * 10_000; // 0.2 % in BPS

async function jupQuote(input, output, amt) {
  try {
    const res = await fetch(`${JUP_API}/quote?inputMint=${input}&outputMint=${output}&amount=${amt}&slippageBps=50&showLiquidity=true`, { signal: AbortSignal.timeout(3_000) });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

/* ---------- 1-second peek into BOTH sources ---------- */
async function peek() {
  // 1.  15-s Jupiter loop (same as arbEngine)
  const q1 = await jupQuote(USDC_MINT, SOL_MINT, LOAN);
  if (q1) {
    const q2 = await jupQuote(SOL_MINT, USDC_MINT, q1.outAmount);
    if (q2) {
      const spreadBPS = Number(q2.outAmount - LOAN) / LOAN * 10_000;
      const minHop    = Math.min(...q1.routePlan.map(h => h.swapInfo.liquidityAvailable),
                                 ...q2.routePlan.map(h => h.swapInfo.liquidityAvailable));
      console.log(`[JUP 15s]  spread=${spreadBPS.toFixed(2)} BPS  shallowest=$${(minHop/1e6).toLocaleString('en')}  loan=$${(LOAN/1e6).toLocaleString('en')}`);
    }
  }

  // 2.  2-s fee-arb micro-scan (same as feeArb)
  const loanMicro = 1_000 * 1e6;
  const q3 = await jupQuote(USDC_MINT, SOL_MINT, loanMicro);
  if (q3) {
    const q4 = await jupQuote(SOL_MINT, USDC_MINT, q3.outAmount);
    if (q4) {
      const grossUSDC = Number(q4.outAmount - loanMicro) / 1e6;
      const spreadBPS = Number(q4.outAmount - loanMicro) / loanMicro * 10_000;
      const kaminoFee = loanMicro * 0.0005 / 1e9;
      const jitoTip   = Math.max(5_000, Math.floor(loanMicro * 0.0001)) / 1e9;
      const compute   = 3_000 / 1e9;
      const netProfit = grossUSDC - (kaminoFee + jitoTip + compute);
      console.log(`[FEE 2s]   loan=$${loanMicro/1e6}  spread=${spreadBPS.toFixed(2)} BPS  net=$${netProfit.toFixed(2)}`);
    }
  }
}

setInterval(peek, 1_000);
peek(); // first fire immediately
