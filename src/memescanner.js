//  src/memescanner.js  – Solana DEX only, dust-filtered, flash-ready
import fetch from 'node-fetch';
import { notify } from './telegram.js';
import { config } from 'dotenv'; config();

const TOKENS        = (process.env.SCAN_TOKENS || 'bonk,wif,popcat,myro,pnut').split(',');
const SCAN_INTERVAL = Number(process.env.SCAN_INTERVAL || 30_000); // ms
const MIN_SPREAD    = Number(process.env.MIN_SPREAD || 2);         // %
const MIN_POOL_LIQ  = Number(process.env.MIN_POOL_LIQ || 30_000);  // USD per pool
const DEXSCREENER   = 'https://api.dexscreener.com/latest/dex/search?q=';
const sleep         = ms => new Promise(r => setTimeout(r, ms));

// hard Solana DEX whitelist
const ALLOW_DEX = ['orca', 'raydium', 'meteora', 'lifinity', 'phoenix'];

async function fetchDexPairs(symbol) {
  try {
    const res = await fetch(`${DEXSCREENER}${encodeURIComponent(symbol)}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) { console.log('DexScreener HTTP', res.status); return null; }
    return await res.json();
  } catch (e) { console.log('DexScreener fetch failed:', e.message); return null; }
}

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
  for (const token of TOKENS) {
    const data = await fetchDexPairs(token.trim());
    if (!data?.pairs?.length) continue;

    // 1. hard Solana DEX whitelist + ≥ min liquidity
    const clean = data.pairs.filter(
      p => ALLOW_DEX.includes((p.dexId || '').toLowerCase()) &&
           Number(p.liquidity?.usd || 0) >= MIN_POOL_LIQ &&
           p.priceUsd && Number(p.priceUsd) > 0
    );
    if (clean.length < 2) continue;

    const bw = chooseHighLow(clean);
    if (!bw) continue;

    const lowLiq  = Number(bw.low.liquidity?.usd || 0);
    const highLiq = Number(bw.high.liquidity?.usd || 0);
    const spread  = bw.spreadPct;

    console.log(`[${token}] spread=${spread.toFixed(2)}% low=${bw.low.price}(${bw.low.dexId}) liq=$${lowLiq} high=${bw.high.price}(${bw.high.dexId}) liq=$${highLiq}`);

    if (spread >= MIN_SPREAD && lowLiq >= MIN_POOL_LIQ && highLiq >= MIN_POOL_LIQ) {
      const msg = [
        '🚨 Live Solana DEX arb ≥ ' + MIN_SPREAD + '%',
        `${token.toUpperCase()} — Spread ${spread.toFixed(2)}%`,
        `Buy  @ ${bw.low.price}  (${bw.low.dexId})  — Liq $${lowLiq.toFixed(0)}`,
        `Sell @ ${bw.high.price} (${bw.high.dexId}) — Liq $${highLiq.toFixed(0)}`
      ].join('\n');
      await notify(msg);
    }
    await sleep(600);
  }
}

export async function startScanner() {
  console.log('Meme-scanner starting for tokens:', TOKENS.join(', '));
  await scanRound();                 // run once immediately
  setInterval(scanRound, SCAN_INTERVAL);
}
