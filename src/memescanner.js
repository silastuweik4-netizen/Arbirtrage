//  src/memescanner.js  – mint-only, dual-oracle, Jupiter-verified, debug-ready
import fetch from 'node-fetch';
import { notify } from './telegram.js';
import { config } from 'dotenv'; config();

const MINTS         = (process.env.SCAN_MINTS || '').split(',').map(m => m.trim());
const MIN_SPREAD    = Number(process.env.MEME_MIN_SPREAD || 0);        // 0 % for debug
const MIN_LIQUIDITY = Number(process.env.MEME_MIN_LIQ || 0);           // 0 USD for debug
const INTERVAL_MS   = Number(process.env.MEME_INTERVAL || 15_000);
const JUP_API       = 'https://quote-api.jup.ag/v6/quote';

const lastAlerts = new Map();
const fmt = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });

async function jupVerify(inputMint, outputMint, amt = 1_000_000) {
  try {
    const u = `${JUP_API}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amt}&slippageBps=50`;
    const r = await fetch(u);
    return r.ok;
  } catch { return false; }
}

async function scanMint(mint) {
  if (!mint) return null;
  // ===== LIVE DEBUG =====
  console.log('[DEBUG]', mint, 'pairs count:', 0); // placeholder until fetch
  // ======================

  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  if (!res.ok) { console.log('DS HTTP', res.status); return null; }
  const json = await res.json();

  // ===== REAL DEBUG =====
  console.log('[DEBUG]', mint, 'pairs count:', json.pairs?.length || 0);
  // ======================

  const pairs = json.pairs?.filter(
    p => p.chainId === 'solana' &&
         Number(p.liquidity?.usd || 0) >= MIN_LIQUIDITY &&
         p.priceUsd && Number(p.priceUsd) > 0
  );
  if (!pairs || pairs.length < 2) return null;

  // log each pool for deep debug
  pairs.forEach((p, i) =>
    console.log('[POOL]', i, p.dexId, 'liq$', Number(p.liquidity?.usd || 0), 'price', p.priceUsd)
  );

  const buy  = pairs.reduce((a, b) => (Number(a.priceUsd) < Number(b.priceUsd) ? a : b));
  const sell = pairs.reduce((a, b) => Number(a.priceUsd) > Number(b.priceUsd) ? a : b);
  if (buy.pairAddress === sell.pairAddress) return null;

  const spread = ((Number(sell.priceUsd) - Number(buy.priceUsd)) / Number(buy.priceUsd)) * 100;
  if (spread < MIN_SPREAD) return null;

  // GeckoTerminal cross-check
  const gtBuyRes  = await fetch(`https://www.geckoterminal.com/api/v2/networks/solana/pools/${buy.pairAddress}`);
  const gtSellRes = await fetch(`https://www.geckoterminal.com/api/v2/networks/solana/pools/${sell.pairAddress}`);
  const buyReserve  = Number((gtBuyRes.ok  ? await gtBuyRes.json()  : null)?.data?.attributes?.reserve_in_usd  || 0);
  const sellReserve = Number((gtSellRes.ok ? await gtSellRes.json() : null)?.data?.attributes?.reserve_in_usd || 0);
  if (buyReserve < MIN_LIQUIDITY || sellReserve < MIN_LIQUIDITY) return null;

  // Jupiter verify
  const routeOk = await jupVerify(buy.baseToken.address, sell.baseToken.address);
  if (!routeOk) return null;

  return {
    mint,
    spread,
    buyDex: buy.dexId,
    buyPrice: buy.priceUsd,
    buyLiq:  buyReserve,
    sellDex: sell.dexId,
    sellPrice: sell.priceUsd,
    sellLiq: sellReserve
  };
}

export function startMemeScanner() {
  if (!MINTS.length) { console.log('No mints in SCAN_MINTS – scanner off'); return; }
  console.log('Mint-scanner starting for', MINTS.length, 'mints');
  scanAll();
  setInterval(scanAll, INTERVAL_MS);
}
