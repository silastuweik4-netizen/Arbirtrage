import { Bot } from "grammy";
import { Connection } from "@solana/web3.js";
import axios from "axios";
import "dotenv/config";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID   = process.env.CHAT_ID;
const RPC       = process.env.RPC || "https://api.mainnet-beta.solana.com";

const conn = new Connection(RPC, "confirmed");
const bot  = new Bot(BOT_TOKEN);

const jupQuote = async (a, b, amt) =>
  (await axios.get(`https://quote-api.jup.ag/v6/quote?inputMint=${a}&outputMint=${b}&amount=${amt}&slippageBps=50`))
    .data.outAmount;

setInterval(async () => {
  try {
    const ONE_SOL = 1_000_000_000;
    const jup = await jupQuote("So11111111111111111111111111111111111111112",
                               "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", ONE_SOL);
    const ray = await jupQuote("So11111111111111111111111111111111111111112",
                               "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", ONE_SOL);
    const diff = (Number(jup) - Number(ray)) / Number(jup) * 100;
    if (Math.abs(diff) > 0.25) {
      await bot.api.sendMessage(CHAT_ID, `🔔 ${diff.toFixed(2)} %`);
    }
  } catch (e) { console.error(e.message); }
}, 10_000);

bot.start();
