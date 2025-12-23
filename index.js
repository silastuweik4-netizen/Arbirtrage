import { Bot } from "grammy";
import "dotenv/config";
import axios from "axios";

const BOT_TOKEN = process.env.BOT_TOKEN?.trim();
const CHAT_ID   = process.env.CHAT_ID?.trim();
if (!BOT_TOKEN || !CHAT_ID) {
  console.error("❌  BOT_TOKEN and CHAT_ID env vars are required");
  process.exit(1);
}
const bot = new Bot(BOT_TOKEN);

// FIXED URL ➜ new Jupiter hostname
const jupQuote = async (a, b, amt) => {
  const url = `https://api.jup.ag/swap/v1/quote?inputMint=${a}&outputMint=${b}&amount=${amt}&slippageBps=50`;
  const { data } = await axios.get(url);
  return BigInt(data.outAmount);
};

const SOL  = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ONE  = 1_000_000_000n;

let last = 0;
setInterval(async () => {
  try {
    const [j, r] = await Promise.all([
      jupQuote(SOL, USDC, ONE),
      jupQuote(SOL, USDC, ONE)   // swap for Raydium later
    ]);
    const p = (Number(j - r) / Number(j)) * 100;
    if (Math.abs(p) > 0.25 && Date.now() - last > 60_000) {
      last = Date.now();
      await bot.api.sendMessage(CHAT_ID, `🔔 ${p.toFixed(2)} %`);
    }
  } catch (e) { console.error("Scan err:", e.message); }
}, 10_000);

bot.start();
