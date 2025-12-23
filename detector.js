//  detector.js  — surgical arbitrage scanner
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from 'dotenv'; config();

const JUP_API = 'https://quote-api.jupiter.ag/v6';
const QUOTE_TTL = 750;                       // ms - BE AGGRESSIVE
const MIN_SPREAD = 0.002;                    // 0.2 %
const MIN_ABSOLUTE_PROFIT_USD = 50;           // $50 minimum profit
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT  = 'So11111111111111111111111111111111111111112';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// CRITICAL: Use a high-performance private RPC URL in your .env file
const conn = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com');

// Define pairs and loan amounts to test
const PAIRS_TO_SCAN = [
  { inputMint: USDC_MINT, outputMint: SOL_MINT, symbol: 'SOL' },
  { inputMint: USDC_MINT, outputMint: USDT_MINT, symbol: 'USDT' },
];
const LOAN_AMOUNTS = [1_000 * 1e6, 5_000 * 1e6, 20_000 * 1e6];

/* ---------- helper ---------- */
async function jupQuote(input, output, amt, showLiquidity = true) {
  const url = `${JUP_API}/quote?inputMint=${input}&outputMint=${output}&amount=${amt}&slippageBps=50&showLiquidity=${showLiquidity}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(QUOTE_TTL) });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

function fmt(num) { return num.toLocaleString('en', { maximumFractionDigits: 0 }); }

/* ---------- surgical scanner ---------- */
async function scanPair(pair) {
  for (const loan of LOAN_AMOUNTS) {
    const leg1 = await jupQuote(pair.inputMint, pair.outputMint, loan);
    if (!leg1 || !leg1.outAmount) continue;
    const leg2 = await jupQuote(pair.outputMint, pair.inputMint, leg1.outAmount);
    if (!leg2 || !leg2.outAmount) continue;

    const spread = Number(leg2.outAmount - loan) / loan;
    const absoluteProfit = (leg2.outAmount - loan) / 1e6;

    // Smarter filtering
    if (spread < MIN_SPREAD || absoluteProfit < MIN_ABSOLUTE_PROFIT_USD) continue;

    const minHop = Math.min(...leg1.routePlan.map(h => h.swapInfo.liquidityAvailable),
                            ...leg2.routePlan.map(h => h.swapInfo.liquidityAvailable));
    const safe   = Math.floor(minHop / 3);

    console.log(
      `[${new Date().toLocaleTimeString()}]  ` +
      `PAIR: ${pair.symbol} | ` +
      `AMOUNT: $${fmt(loan/1e6)} | ` +
      `SPREAD: ${(spread * 100).toFixed(3)}% | ` +
      `PROFIT: $${absoluteProfit.toFixed(2)} | ` +
      `SAFE LOAN: $${fmt(safe)}`
    );
  }
}

async function scan() {
  const promises = PAIRS_TO_SCAN.map(pair => scanPair(pair));
  await Promise.all(promises);
}

/* ---------- loop ---------- */
setInterval(scan, 500); // Scan every 500ms
scan(); // first fire
