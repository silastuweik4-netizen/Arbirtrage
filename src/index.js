import express from "express";
import WebSocket from "ws";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// === Telegram Config ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; // set in Render Env
const CHAT_ID = process.env.CHAT_ID;               // your Telegram user/group ID
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// 👋 Simple healthcheck for Render
app.get("/", (req, res) => {
  res.send("🚀 Mango WebSocket liquidation tracker is running...");
});

app.listen(PORT, () => {
  console.log(`🌐 Server listening on port ${PORT}`);
  startWebSocket();
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

// === WebSocket connection to Mango ===
function startWebSocket() {
  const ws = new WebSocket("wss://api.mango.markets/v4/ws");

  ws.on("open", () => {
    console.log("🔌 Connected to Mango WebSocket");

    // subscribe to liquidation events
    ws.send(
      JSON.stringify({
        op: "subscribe",
        channel: "liquidations"
      })
    );
  });

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data?.channel === "liquidations" && data?.data) {
        console.log("⚡ Liquidation Event:", data.data);

        const liq = data.data;

        const message = `
⚡ *Mango Liquidation Alert* ⚡

- Account: \`${liq.account || "unknown"}\`
- Asset: ${liq.asset || "N/A"}
- Amount: ${liq.amount || "N/A"}
- Price: ${liq.price || "N/A"}
- Time: ${new Date().toISOString()}
        `;

        await sendTelegramMessage(message);
      }
    } catch (err) {
      console.error("❌ Error processing message:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("❌ WebSocket closed, retrying in 5s...");
    setTimeout(startWebSocket, 5000);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err.message);
  });
        }
