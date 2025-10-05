//  src/memescanner.js  – mint-only, identical-token, flash-ready
import fetch from 'node-fetch';
import { notify } from './telegram.js';
import { config } from 'dotenv'; config();

const MINTS         = (process.env.SCAN_MINTS || '').split(',').map(m => m.trim());
const SCAN_INTERVAL = Number(process.env.SCAN_INTERVAL || 30_000); // ms
const MIN_SPREAD    = Number(process.env.MIN_SPREAD || 3);         // %
const MIN_POOL_LIQ  = Number(process.env.MIN_POOL_LIQ || 30_000);  // USD per pool
const DEXSCREENER   = 'https://api.dexscreener.com/latest/dex/tokens/';
const sleep         = ms => new Promise(r => setTimeout(r, ms));

// hard Solana DEX whitelist
const ALLOW_DEX = ['orca', 'raydium', 'meteora', 'lifinity', 'phoenix'];

function chooseHighLow(pairs) {
  const usable = (pairs || []).filter(p => p.priceUsd && Number(p.priceUsd) > 0)
                               .map(p => ({ ...p, price: Number(p.priceUsd) }));
  if (usable.length < 2) return null;
  usable.sort((a, b) => a.price - b.price);
  return {
    low : usable[0],
    high: usable[usable.length - 1],
    spreadPct: ((usable[usable.length - 1].price - usable[0].price) / usable[0].price) * 100
  };
}

async function scanRound() {
  for (const mint of MINTS) {
    if (!mint) continue;
    const url = `${DEXSCREENER}${mint}`;
    const res = await fetch(url);
    if (!res.ok) { console.log('DexScreener mint HTTP', res.status); continue; }
    const json = await res.json();
    if (!json.pairs?.length) continue;

    // same-mint only + allowed DEX + ≥ min liquidity
    const clean = json.pairs.filter(
      p => p.chainId === 'solana' &&
           ALLOW_DEX.includes((p.dexId || '').toLowerCase()) &&
           Number(p.liquidity?.usd || 0) >= MIN_POOL_LIQ &&
           p.priceUsd && Number(p.priceUsd) > 0
    );
    if (clean.length < 2) continue;

    const bw = chooseHighLow(clean);
    if (!bw) continue;

    const spread = bw.spreadPct;
    const lowLiq  = Number(bw.low.liquidity?.usd || 0);
    const highLiq = Number(bw.high.liquidity?.usd || 0);

    console.log(`[${mint.slice(0, 8)}…] spread=${spread.toFixed(2)}% low=${bw.low.price}(${bw.low.dexId}) liq=$${lowLiq} high=${bw.high.price}(${bw.high.dexId}) liq=$${highLiq}`);

    if (spread >= MIN_SPREAD && lowLiq >= MIN_POOL_LIQ && highLiq >= MIN_POOL_LIQ) {
      const msg = [
        '🚨 Live SPL-mint arb ≥ ' + MIN_SPREAD + '%',
        `Mint ${mint} — Spread ${spread.toFixed(2)}%`,
        `Buy  @ ${bw.low.price}  (${bw.low.dexId})   — Liq $${lowLiq.toFixed(0)}`,
        `Sell @ ${bw.high.price} (${bw.high.dexId})  — Liq $${highLiq.toFixed(0)}`
      ].join('\n');
      await notify(msg);
    }
    await sleep(600);
  }
}

export async function startScanner() {
  console.log('Mint-scanner starting for:', MINTS.length, 'mints');
  await scanRound();
  setInterval(scanRound, SCAN_INTERVAL);
}
