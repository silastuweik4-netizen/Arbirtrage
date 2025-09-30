import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// === Telegram Config ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; // set this in Render Env vars
const CHAT_ID = process.env.CHAT_ID; // your Telegram user/group ID
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// 👋 Simple healthcheck
app.get("/", (req, res) => {
  res.send("🚀 Mango liquidation tracker is running...");
});

// Start Express server
app.listen(PORT, () => {
  console.log(`🌐 Server listening on port ${PORT}`);
  startTracker();
});

// === Helper: Send Telegram Alerts ===
async function sendTelegramMessage(message) {
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: "Markdown"
      }),
    });
  } catch (err) {
    console.error("❌ Error sending Telegram message:", err.message);
  }
}

// === Mango Liquidation Tracker Logic ===
async function startTracker() {
  console.log("🚀 Mango liquidation tracker started...");

  const endpoint = "https://api.mngo.cloud/liquidations"; // example endpoint (replace with real)

  while (true) {
    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();

      if (data && data.length > 0) {
        console.log("⚡ Liquidations detected:", data);

        for (const liq of data) {
          const msg = `
⚡ *Mango Liquidation Alert* ⚡

- Account: \`${liq.account || "unknown"}\`
- Asset: ${liq.asset || "N/A"}
- Amount: ${liq.amount || "N/A"}
- Price: ${liq.price || "N/A"}
- Timestamp: ${new Date().toISOString()}
          `;
          await sendTelegramMessage(msg);
        }
      } else {
        console.log("✅ No liquidations right now...");
      }
    } catch (err) {
      console.error("❌ Error fetching liquidations:", err.message);
    }

    // poll every 10 seconds
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}
