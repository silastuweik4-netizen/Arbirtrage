//  forceProof.js  — brute-force Jupiter every 500 ms, loud output
import { config } from 'dotenv'; config();

const JUP_API = 'https://quote-api.jupiter.ag/v6';
const USDC  = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL   = 'So11111111111111111111111111111111111111112';
const LOAN  = 1_000 * 1e6;

let count = 0;
async function brute() {
  count++;
  try {
    const q1 = await fetch(`${JUP_API}/quote?inputMint=${USDC}&outputMint=${SOL}&amount=${LOAN}&slippageBps=50&showLiquidity=true`).then(r => r.ok ? r.json() : null);
    if (!q1) { console.log(`[BRUTE-${count}]  Jupiter returned null`); return; }
    const q2 = await fetch(`${JUP_API}/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${q1.outAmount}&slippageBps=50&showLiquidity=true`).then(r => r.ok ? r.json() : null);
    if (!q2) { console.log(`[BRUTE-${count}]  Jupiter leg2 null`); return; }

    const gross = Number(q2.outAmount - LOAN) / 1e6;
    const bps   = Number(q2.outAmount - LOAN) / LOAN * 10_000;
    const net   = gross - (LOAN * 0.0006) / 1e9; // Kamino + tip + compute
    console.log(`[BRUTE-${count}]  loan=$${LOAN/1e6}  spread=${bps.toFixed(3)} BPS  net=$${net.toFixed(4)}  shallowest=$${Math.min(...q1.routePlan.map(h => h.swapInfo.liquidityAvailable), ...q2.routePlan.map(h => h.swapInfo.liquidityAvailable))/1e6}`);
  } catch (e) {
    console.log(`[BRUTE-${count}]  ERROR: ${e.message}`);
  }
}

setInterval(brute, 500);
brute(); // first fire immediately
