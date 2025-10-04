// BONK Arbitrage Scanner (Free Plan)
// Scans every 15s for >= +1% arbitrage spread between DexScreener & Jupiter

import fetch from "node-fetch";
import { config } from "dotenv";
import { notify } from "./telegram.js";  // your notify() helper
config();

const PAIR = "So11111111111111111111111111111111111111112"; // BONK/SOL example token (replace if needed)
const MIN_PROFIT = 1; // percent
const SCAN_INTERVAL = 15000; // 15 seconds

// --- DexScreener fetch ---
async function getDexScreenerPrice() {
  try {
    const url = "https://api.dexscreener.com/latest/dex/search?q=bonk";
    const res = await fetch(url);
    const data = await res.json();
    const bonkPair = data.pairs.find(p => p.baseToken.symbol === "BONK");
    return bonkPair ? Number(bonkPair.priceUsd) : null;
  } catch (e) {
    console.log("DexScreener fetch error:", e.message);
    return null;
  }
}

// --- Jupiter Aggregator price ---
async function getJupiterPrice() {
  try {
    const url = "https://price.jup.ag/v6/price?ids=bonk";
    const res = await fetch(url);
    const data = await res.json();
    return data?.data?.bonk?.price || null;
  } catch (e) {
    console.log("Jupiter fetch error:", e.message);
    return null;
  }
}

// --- Core scanner ---
async function scanBONK() {
  const [dexPrice, jupPrice] = await Promise.all([getDexScreenerPrice(), getJupiterPrice()]);

  if (!dexPrice || !jupPrice) {
    console.log("❌ Missing data from one source.");
    return;
  }

  const spread = (Math.abs(dexPrice - jupPrice) / ((dexPrice + jupPrice) / 2)) * 100;
  const msg = `📊 BONK Arbitrage Check\nDexScreener: $${dexPrice.toFixed(6)}\nJupiter: $${jupPrice.toFixed(6)}\nSpread: ${spread.toFixed(3)}%`;

  if (spread >= MIN_PROFIT) {
    console.log("✅ Arbitrage detected! Sending Telegram alert...");
    await notify(`🚀 <b>BONK Arbitrage</b>\n<b>Spread:</b> ${spread.toFixed(3)}%\n<b>Dex:</b> $${dexPrice.toFixed(6)}\n<b>Jupiter:</b> $${jupPrice.toFixed(6)}\n<b>Time:</b> ${new Date().toLocaleTimeString()}`);
  } else {
    console.log(msg);
  }
}

// --- Continuous loop ---
(async function loop() {
  console.log("🔁 BONK arbitrage scanner started...");
  while (true) {
    await scanBONK();
    await new Promise(r => setTimeout(r, SCAN_INTERVAL));
  }
})();
