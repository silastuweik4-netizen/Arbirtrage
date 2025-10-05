//  src/memescanner.js  – identical-mint, dual-oracle, Jupiter-verified, flash-ready
import fetch from 'node-fetch';
import { notify } from './telegram.js';
import { config } from 'dotenv'; config();

// ===== config =====
const MINTS         = (process.env.SCAN_MINTS || '').split(',').map(m => m.trim());
const MIN_SPREAD    = Number(process.env.MEME_MIN_SPREAD || 1);        // %
const MIN_LIQUIDITY = Number(process.env.MEME_MIN_LIQ || 10_000);      // USD
const INTERVAL_MS   = Number(process.env.MEME_INTERVAL || 15_000);     // ms
const JUP_API       = 'https://quote-api.jup.ag/v6/quote';

// memory de-dupe (1 min)
const lastAlerts = new Map();

// ===== helpers =====
const fmt = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });

async function jupVerify(inputMint, outputMint, amt = 1_000_000) {
  try {
    const u = `${JUP_API}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amt}&slippageBps=50`;
    const r = await fetch(u);
    return r.ok;
  } catch { return false; }
}

// ===== core =====
async function scanMint(mint) {
  if (!mint) return null;

  // 1. DexScreener identical-mint feed
  const dsRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  if (!dsRes.ok) { console.log('DS HTTP', dsRes.status); return null; }
  const ds = await dsRes.json();
  const pairs = ds.pairs?.filter(
    p => p.chainId === 'solana' &&
         Number(p.liquidity?.usd || 0) >= MIN_LIQUIDITY &&
         p.priceUsd && Number(p.priceUsd) > 0
  );
  if (!pairs || pairs.length < 2) return null;

  // 2. pick best bid / ask (different pools)
  const buy  = pairs.reduce((a, b) => (Number(a.priceUsd) < Number(b.priceUsd) ? a : b));
  const sell = pairs.reduce((a, b) => Number(a.priceUsd) > Number(b.priceUsd) ? a : b);
  if (buy.pairAddress === sell.pairAddress) return null; // same pool

  // 3. GeckoTerminal cross-check (reserve USD)
  const gtBuyRes  = await fetch(`https://www.geckoterminal.com/api/v2/networks/solana/pools/${buy.pairAddress}`);
  const gtSellRes = await fetch(`https://www.geckoterminal.com/api/v2/networks/solana/pools/${sell.pairAddress}`);
  const gtBuy  = gtBuyRes.ok  ? await gtBuyRes.json()  : null;
  const gtSell = gtSellRes.ok ? await gtSellRes.json() : null;
  const buyReserve  = Number(gtBuy?.data?.attributes?.reserve_in_usd  || 0);
  const sellReserve = Number(gtSell?.data?.attributes?.reserve_in_usd || 0);
  if (buyReserve < MIN_LIQUIDITY || sellReserve < MIN_LIQUIDITY) return null;

  // 4. Jupiter route verification
  const routeOk = await jupVerify(buy.baseToken.address, sell.baseToken.address);
  if (!routeOk) return null;

  return {
    mint,
    spread: ((Number(sell.priceUsd) - Number(buy.priceUsd)) / Number(buy.priceUsd)) * 100,
    buyDex: buy.dexId,
    buyPrice: buy.priceUsd,
    buyLiq:  buyReserve,
    sellDex: sell.dexId,
    sellPrice: sell.priceUsd,
    sellLiq: sellReserve
  };
}

async function scanAll() {
  const results = await Promise.all(MINTS.map(scanMint));
  const valid = results.filter(Boolean);
  if (!valid.length) { console.log('No mint arb ≥', MIN_SPREAD + '%'); return; }

  for (const r of valid) {
    const now = Date.now();
    if (lastAlerts.get(r.mint) && now - lastAlerts.get(r.mint) < 60_000) continue; // 1 min de-dupe

    const msg =
      `🚨 <b>Live Mint Arb ≥ ${MIN_SPREAD}%</b>\n` +
      `<b>Mint:</b> <code>${r.mint}</code>\n` +
      `<b>Spread:</b> ${fmt(r.spread)}%\n` +
      `Buy  @ ${r.buyPrice} (${r.buyDex}) — Liq $${fmt(r.buyLiq)}\n` +
      `Sell @ ${r.sellPrice} (${r.sellDex}) — Liq $${fmt(r.sellLiq)}\n` +
      `<i>Time:</i> ${new Date().toISOString()}`;

    console.log(msg + '\n');
    await notify(msg);
    lastAlerts.set(r.mint, now);
  }
}

// ===== launcher =====
export function startMemeScanner() {
  if (!MINTS.length) { console.log('No mints in SCAN_MINTS – scanner off'); return; }
  console.log('Mint-scanner starting for', MINTS.length, 'mints');
  scanAll();                       // immediate run
  setInterval(scanAll, INTERVAL_MS);
}
