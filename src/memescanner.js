//  src/memescanner.js  – timeout + retry, Jupiter-only, blackout-proof
import fetch from 'node-fetch';
import { notify } from './telegram.js';
import { config } from 'dotenv'; config();

const MINTS         = (process.env.SCAN_MINTS || '').split(',').map(m => m.trim());
const MIN_SPREAD    = Number(process.env.MEME_MIN_SPREAD || 0.2);
const MIN_LIQUIDITY = Number(process.env.MEME_MIN_LIQ || 10_000);
const INTERVAL_MS   = Number(process.env.MEME_INTERVAL || 15_000);
const JUP_API       = 'https://quote-api.jup.ag/v6/quote';

const lastAlerts = new Map();
const fmt = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });

// ===== timeout + retry =====
async function fetchWithRetry(url, opts = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 3000); // 3 s timeout
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return r;
  } catch (e) {
    clearTimeout(id);
    console.log('Jupiter fetch fail, retrying…', e.message);
    const controller2 = new AbortController();
    const id2 = setTimeout(() => controller2.abort(), 3000);
    try {
      const r2 = await fetch(url, { ...opts, signal: controller2.signal });
      clearTimeout(id2);
      return r2;
    } catch (e2) {
      clearTimeout(id2);
      throw e2; // both failed
    }
  }
}

// ===== Jupiter-only scan =====
async function scanMint(mint) {
  if (!mint) return null;
  const url = `${JUP_API}?inputMint=${mint}&outputMint=So11111111111111111111111111111111111111112&amount=1000000&slippageBps=50`;
  const res = await fetchWithRetry(url);
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

// ===== launcher =====
async function scanAll() {
  const results = await Promise.all(MINTS.map(scanMint));
  const valid = results.filter(Boolean);
  if (!valid.length) { console.log('No mint arb ≥', Number(process.env.MEME_MIN_SPREAD || 0.2) + '%'); return; }
  for (const r of valid) {
    const now = Date.now();
    if (lastAlerts.get(r.mint) && now - lastAlerts.get(r.mint) < 60_000) continue;
    const msg =
      `🚨 <b>Live Jupiter Arb ≥ ${Number(process.env.MEME_MIN_SPREAD || 0.2)}%</b>\n` +
      `<b>Mint:</b> <code>${r.mint}</code>\n` +
      `<b>Spread:</b> ${fmt(r.spread)}%\n` +
      `Buy  @ ${r.buyPrice} (${r.buyDex})   — Liq $${fmt(r.buyLiq)}\n` +
      `Sell @ ${r.sellPrice} (${r.sellDex}) — Liq $${fmt(r.sellLiq)}\n` +
      `<i>Time:</i> ${new Date().toISOString()}`;
    console.log(msg + '\n');
    await notify(msg);
    lastAlerts.set(r.mint, now);
  }
}

export function startMemeScanner() {
  if (!MINTS.length) { console.log('No mints in SCAN_MINTS – scanner off'); return; }
  console.log('Jupiter-scanner starting for', MINTS.length, 'mints');
  scanAll();
  setInterval(scanAll, INTERVAL_MS);
}
