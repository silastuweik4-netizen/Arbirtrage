import { Bot } from "grammy";
import "dotenv/config";
import axios from "axios";

const BOT_TOKEN  = process.env.BOT_TOKEN?.trim();
const CHAT_ID    = process.env.CHAT_ID?.trim();
const JUP_KEY    = process.env.JUP_API_KEY?.trim();   // <- new free key from Jupiter

if (!BOT_TOKEN || !CHAT_ID || !JUP_KEY) {
  console.error("❌  BOT_TOKEN, CHAT_ID and JUP_API_KEY env vars are required");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// ---------- Jupiter v4 quote (with free key) ----------
const jupQuote = async (mintIn, mintOut, amount) => {
  const url = `https://api.jup.ag/swap/v1/quote?inputMint=${mintIn}&outputMint=${mintOut}&amount=${amount}&slippageBps=50`;
  const { data } = await axios.get(url, { headers: { "x-api-key": JUP_KEY } });
  return BigInt(data.outAmount);
};

// ---------- main loop ----------
const SOL  = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ONE  = 1_000_000_000n;

let lastAlert = 0;
setInterval(async () => {
  try {
    const [jupOut, rayOut] = await Promise.all([
      jupQuote(SOL, USDC, ONE),
      jupQuote(SOL, USDC, ONE)   // replace with Raydium when you have it
    ]);

    const diff = Number(jupOut - rayOut);
    const pct  = (diff / Number(jupOut)) * 100;

    if (Math.abs(pct) > 0.25 && Date.now() - lastAlert > 60_000) {
      lastAlert = Date.now();
      await bot.api.sendMessage(
        CHAT_ID,
        `🔔 Arb: ${pct.toFixed(2)} %\n` +
        `Jup: ${(Number(jupOut)/1e6).toFixed(2)} USDC\n` +
        `Ray: ${(Number(rayOut)/1e6).toFixed(2)} USDC`
      );
    }
  } catch (e) {
    console.error("Scan err:", e.message);
  }
}, 10_000);

bot.start({ onStart: () => console.log("Bot started") });
