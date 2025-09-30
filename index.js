import axios from "axios";
import TelegramBot from "node-telegram-bot-api";

// === CONFIG ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;  
const CHAT_ID = process.env.CHAT_ID;                

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// Track last seen liquidation to avoid duplicates
let lastSeenTime = 0;

// === Mango Liquidation Tracker ===
async function checkLiquidations() {
  try {
    const url = "https://api.mngo.cloud/v1/stats/liquidations"; 
    const { data } = await axios.get(url);

    if (!data || data.length === 0) {
      console.log("No liquidations found.");
      return;
    }

    // Only new events
    const newEvents = data.filter(liq => liq.time > lastSeenTime);

    if (newEvents.length > 0) {
      lastSeenTime = Math.max(...newEvents.map(e => e.time));

      for (let liq of newEvents) {
        const account = liq.account || "unknown";
        const market = liq.market || "N/A";
        const amount = liq.amount || 0;
        const timestamp = new Date(liq.time).toLocaleString();

        const message = `
⚠️ Mango Liquidation Detected
👤 Account: ${account}
📊 Market: ${market}
💰 Amount: ${amount}
🕒 Time: ${timestamp}
        `;

        // Inline keyboard (Solscan link)
        const opts = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🔎 View Account", url: `https://solscan.io/account/${account}` }
              ]
            ]
          }
        };

        await bot.sendMessage(CHAT_ID, message.trim(), opts);
      }
    }
  } catch (err) {
    console.error("Error fetching liquidations:", err.message);
  }
}

// Run every 20s
setInterval(checkLiquidations, 20000);

console.log("🚀 Mango liquidation tracker started...");
