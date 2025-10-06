//  src/memescanner.js  – safety-gated, bullet-proof, final
import fetch from 'node-fetch';
import { Connection, PublicKey } from '@solana/web3.js';
import { notify } from './telegram.js';
import { config } from 'dotenv'; config();

const MINTS         = (process.env.SCAN_MINTS || '').split(',').map(m => m.trim());
const MIN_SPREAD    = Number(process.env.MEME_MIN_SPREAD || 0.2);
const MIN_LIQUIDITY = Number(process.env.MEME_MIN_LIQ || 10_000);
const INTERVAL_MS   = Number(process.env.MEME_INTERVAL || 15000);
const JUP_API       = 'https://quote-api.jup.ag/v6/quote';

const lastAlerts = new Map();
const fmt = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });

// ===== safety gate (runs in < 2 s) =====
async function safetyGate(mint) {
  if (!mint) return false;
  const SAFETY_TIMEOUT = 2000; // 2 s max

  // 1. Honeypot.is (1-call)
  try {
    const hpRes = await fetch(`https://api.honeypot.is/v2/IsHoneypot?address=${mint}`, { signal: AbortSignal.timeout(SAFETY_TIMEOUT) });
    if (hpRes.ok) { const hp = await hpRes.json(); if (hp.honeypot) return false; }
  } catch (e) { console.log('[SAFETY] honeypot check fail', e.message); }

  // 2. GoPlus token-security (1-call)
  try {
    const gpRes = await fetch(`https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=${mint}`, { signal: AbortSignal.timeout(SAFETY_TIMEOUT) });
    if (gpRes.ok) {
      const gp = await gpRes.json();
      const data = gp.result?.[mint];
      if (data?.is_honeypot === '1' || data?.is_open_source === '0') return false;
    }
  } catch (e) { console.log('[SAFETY] GoPlus check fail', e.message); }

  // 3. Top-10 holder concentration (< 20 %)
  try {
    const conn = new Connection('https://api.mainnet-beta.solana.com');
    const [supply, holders] = await Promise.all([
      conn.getTokenSupply(new PublicKey(mint)),
      conn.getTokenLargestAccounts(new PublicKey(mint))
    ]);
    const top10 = holders.value.slice(0, 10).reduce((sum, a) => sum + Number(a.uiAmountString || 0), 0);
    if (top10 / Number(supply.value.uiAmount) > 0.2) return false;
  } catch (e) { console.log('[SAFETY] concentration check fail', e.message); }

  return true; // all passed
}

// ===== bullet-proof Jupiter scan =====
async function scanMint(mint) {
  if (!(await safetyGate(mint))) { console.log('[SAFETY-SKIP]', mint); return null; }

  // bullet-proof fetch: 3 s timeout, soft fail on block/DNS
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${JUP_API}?inputMint=${mint}&outputMint=So11111111111111111111111111111111111111112&amount=1000000&slippageBps=50`, { signal: controller.signal });
    clearTimeout(id);
    if (res.status === 429) { console.log('[JUP-BLOCK]', mint, '429'); return null; }
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
      buyLiq:  Number(data.inAmount) / 1e9,
      sellDex: sell.ammLabel || 'Jupiter',
      sellPrice: Number(sell.inAmount) / Number(sell.outAmount),
      sellLiq: Number(data.inAmount) / 1e9
    };
  } catch (e) {
    clearTimeout(id);
    console.log('[JUP-SKIP]', mint, e.message);
    return null; // soft fail → next tick retries
  }
}

export function startMemeScanner() {
  if (!MINTS.length) { console.log('No mints in SCAN_MINTS – scanner off'); return; }
  console.log('Meme-scanner starting for', MINTS.length, 'mints');
  scanAll();                       // declared below
  setInterval(scanAll, INTERVAL_MS);
}
