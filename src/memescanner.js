//  src/memescanner.js  – minimal, crash-free, pure Jupiter quote
import fetch from 'node-fetch';
import { notify } from './telegram.js';
import { config } from 'dotenv'; config();

const MINTS         = (process.env.SCAN_MINTS || '').split(',').map(m => m.trim());
const MIN_SPREAD    = Number(process.env.MEME_MIN_SPREAD || 0.2);
const INTERVAL_MS   = Number(process.env.MEME_INTERVAL || 15000);
const JUP_API       = 'https://quote-api.jup.ag/v6/quote';

const lastAlerts = new Map();
const fmt = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });

// ===== pure Jupiter scan (no external calls) =====
async function scanMint(mint) {
  if (!mint) return null;
  // pure Jupiter quote – no safety gate, no external calls
  const res = await fetch(`${JUP_API}?inputMint=${mint}&outputMint=So11111111111111111111111111111111111111112&amount=1000000&slippageBps=50`);
  if (!res.ok) { console.log('Jupiter HTTP', res.status); return null; }
  const data = await res.json();
  if (!data.routePlan || data.routePlan.length < 2) return null; // need ≥ 2 hops for spread
  const legs = data.routePlan.map(p => p.swapInfo);
  const buy  = legs.reduce((a, b) => (Number(a.outAmount) < Number(b.outAmount) ? a : b));
  const sell = legs.reduce((a, b) => (Number(a.outAmount) > Number(b.outAmount) ? a : b));
  if (buy === sell) return null; // same leg
  const spread = ((Number(sell.outAmount) - Number(buy.outAmount)) / Number(buy.outAmount)) * 100;
  if (spread < Number(process.env.MEME_MIN_SPREAD || 0.2)) return null;

  return {
    mint,
    spread,
    buyDex: buy.ammLabel || 'Jupiter',
    buyPrice: Number(buy.inAmount) / Number(buy.outAmount),
    buyLiq:  Number(data.inAmount) / 1e9, // proxy USD
    sellDex: sell.ammLabel || 'Jupiter',
    sellPrice: Number(sell.inAmount) / Number(sell.outAmount),
    sellLiq: Number(data.inAmount) / 1e9
  };
}

export function startMemeScanner() {
  if (!MINTS.length) { console.log('No mints in SCAN_MINTS – scanner off'); return; }
  console.log('Meme-scanner starting for', MINTS.length, 'mints');
  scanAll();                       // declared below
  setInterval(scanAll, INTERVAL_MS);
}
