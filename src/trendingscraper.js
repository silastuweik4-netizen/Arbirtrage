//  src/trendingscraper.js  – DexScreener HTML scrape, no API, no blacklists
import fetch from 'node-fetch';
import { notify } from './telegram.js';
import { config } from 'dotenv'; config();

const MIN_SPREAD    = Number(process.env.TREND_MIN_SPREAD || 0.2);
const INTERVAL_MS   = Number(process.env.TREND_INTERVAL || 60_000); // 1 min
const lastAlerts    = new Map();
const fmt = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });

// ===== HTML scrape =====
async function scrapeTrending() {
  const html = await fetch('https://dexscreener.com/?chain=solana&embed=1&theme=dark').then(r => r.text());
  const regex = /href="\/solana\/([A-Za-z0-9]+)"[\s\S]*?spread.*?([\d\.]+)%[\s\S]*?baseToken.*?address":"([A-Za-z0-9]{43,})"/g;
  const matches = [...html.matchAll(regex)];
  const live = [];
  for (const m of matches) {
    const spread = Number(m[2]);
    const mint   = m[3];
    if (spread >= MIN_SPREAD) live.push({ spread, mint, token: m[1] });
  }
  return live;
}

// ===== launcher =====
export async function startTrendingScanner() {
  console.log('Trending-scraper starting…');
  async function loop() {
    const list = await scrapeTrending();
    if (!list.length) { console.log('No trending arb ≥', MIN_SPREAD + '%'); return; }
    for (const r of list) {
      const now = Date.now();
      if (lastAlerts.get(r.mint) && now - lastAlerts.get(r.mint) < 60_000) continue;
      const msg =
        `🚨 <b>Live Trending Arb ≥ ${MIN_SPREAD}%</b>\n` +
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
