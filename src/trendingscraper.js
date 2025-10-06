//  src/trendingscraper.js  – auto-append new mints to SCAN_MINTS within the same tick
import fetch from 'node-fetch';
import { notify } from './telegram.js';
import { config } from 'dotenv'; config();

const MIN_SPREAD    = Number(process.env.TREND_MIN_SPREAD || 0.2);
const INTERVAL_MS   = Number(process.env.TREND_INTERVAL || 15_000);
const lastAlerts    = new Map();
const fmt = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });

// ===== auto-append helper =====
function appendMint(mint) {
  const current = (process.env.SCAN_MINTS || '').split(',').map(m => m.trim());
  if (current.includes(mint)) return; // already present
  const updated = [...current, mint].join(',');
  process.env.SCAN_MINTS = updated;   // in-memory only (Render re-reads on next tick)
  console.log('[AUTO-APPEND]', mint);
}

// ===== HTML scrape + auto-append =====
async function scrapeTrending() {
  const html = await fetch('https://dexscreener.com/?chain=solana&embed=1&theme=dark').then(r => r.text());
  const regex = /href="\/solana\/([A-Za-z0-9]+)"[\s\S]*?spread.*?([\d\.]+)%[\s\S]*?baseToken.*?address":"([A-Za-z0-9]{43,})"/g;
  const matches = [...html.matchAll(regex)];
  const live = [];
  for (const m of matches) {
    const spread = Number(m[2]);
    const mint   = m[3];
    if (spread >= Number(process.env.TREND_MIN_SPREAD || 0.2)) {
      live.push({ spread, mint, token: m[1] });
      appendMint(mint);           // ← auto-append within the same tick
    }
  }
  return live;
}

// ===== launcher =====
export async function startTrendingScanner() {
  console.log('Trending-auto-scanner starting…');
  async function loop() {
    const list = await scrapeTrending();
    if (!list.length) { console.log('No trending arb ≥', Number(process.env.TREND_MIN_SPREAD || 0.2) + '%'); return; }
    for (const r of list) {
      const now = Date.now();
      if (lastAlerts.get(r.mint) && now - lastAlerts.get(r.mint) < 60_000) continue;
      const msg =
        `🚨 <b>Live Trending Arb ≥ ${Number(process.env.TREND_MIN_SPREAD || 0.2)}%</b>\n` +
        `<b>Token:</b> ${r.token}  <code>${r.mint}</code>\n` +
        `<b>Spread:</b> ${fmt(r.spread)}%\n` +
        `<i>Time:</i> ${new Date().toISOString()}`;
      console.log(msg + '\n');
      await notify(msg);
      lastAlerts.set(r.mint, now);
    }
  }
  loop();
  setInterval(loop, INTERVAL_MS);
}
