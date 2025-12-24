//  liveProof.js  — raw Jupiter peek (shows ALL opportunities, even negative)
import { config } from 'dotenv'; config();

const JUP_API   = 'https://quote-api.jupiter.ag/v6';
const USDC      = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL       = 'So11111111111111111111111111111111111111112';
const LOAN      = 1_000 * 1e6;   // $1 000 (micro-size)

let count = 0;
async function peek() {
  count++;
  try {
    const q1 = await fetch(`${JUP_API}/quote?inputMint=${USDC}&outputMint=${SOL}&amount=${LOAN}&slippageBps=50&showLiquidity=true`).then(r => r.ok ? r.json() : null);
    if (!q1) {
      console.log(`[RAW-${count}] Jupiter leg1 failed`);
      return;
    }
    const q2 = await fetch(`${JUP_API}/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${q1.outAmount}&slippageBps=50&showLiquidity=true`).then(r => r.ok ? r.json() : null);
    if (!q2) {
      console.log(`[RAW-${count}] Jupiter leg2 failed`);
      return;
    }

    const grossUSDC = Number(q2.outAmount - LOAN) / 1e6;
    const spreadBPS = Number(q2.outAmount - LOAN) / LOAN * 10_000;
    const minHop    = Math.min(...q1.routePlan.map(h => h.swapInfo.liquidityAvailable),
                               ...q2.routePlan.map(h => h.swapInfo.liquidityAvailable));
    const netProfit = grossUSDC - (LOAN * 0.0006) / 1e9; // Kamino + tip + compute

    // SHOW EVERYTHING - no filtering whatsoever
    console.log(`[RAW-${count}] loan=$${LOAN/1e6} spread=${spreadBPS.toFixed(3)} BPS gross=$${grossUSDC.toFixed(4)} net=$${netProfit.toFixed(4)} shallowest=$${(minHop/1e6).toLocaleString('en')}`);
    
    // Also show color-coded profitability
    if (netProfit > 0) {
      console.log(`[RAW-${count}] ✅ PROFITABLE: +$${netProfit.toFixed(4)}`);
    } else if (netProfit > -0.5) {
      console.log(`[RAW-${count}] ⚠️  BREAK-EVEN: $${netProfit.toFixed(4)}`);
    } else {
      console.log(`[RAW-${count}] ❌ LOSS: $${netProfit.toFixed(4)}`);
    }

  } catch (e) {
    console.log(`[RAW-${count}] ERROR: ${e.message}`);
  }
}

setInterval(peek, 500);
peek(); // first fire immediately
