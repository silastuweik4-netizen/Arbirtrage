//  seedScanner.js  — off-peak spread seed (top-20 by volume)
import fetch from 'node-fetch';
import { notify } from './telegram.js';

const MIN_SEED_SPREAD = 0.001; // 0.1 %
const SEED_INTERVAL   = 30 * 60 * 1_000; // 30 min
const TOP_N           = 20;

/* ---------- fetch top pools by 24 h volume ---------- */
async function getTopPools() {
  const url = 'https://api.dexscreener.com/latest/dex/pairs/solana&order=volume&page=1&perPage=' + TOP_N;
  const res = await fetch(url);
  if (!res.ok) return [];
  const { pairs } = await res.json();
  return pairs.map(p => ({
    pair:      p.pairAddress,
    spread:  Number(p.priceChange?.h24 || 0) / 100, // use 24 h % as proxy
    tokenA:  p.baseToken.address,
    tokenB:  p.quoteToken.address,
    liq:     Number(p.liquidity?.usd || 0)
  }));
}

/* ---------- filter & inject ---------- */
export async function startSeedScanner(onSeed) {
  async function loop() {
    const pools = await getTopPools();
    for (const p of pools) {
      if (p.spread >= MIN_SEED_SPREAD && p.liq >= 5_000) { // same auto-cap floor
        console.log('[SEED]  Top-20 spread:', (p.spread*100).toFixed(2)+'%', 'pair:', p.pair);
        await onSeed(p);          // inject into normal loop
      }
    }
  }
  loop();
  setInterval(loop, SEED_INTERVAL);
}
