import express from "express";
import WebSocket from "ws";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// === CONFIG ===
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RPC_URL = "wss://api.mainnet-beta.solana.com"; 
const MANGO_V4_PROGRAM = "22YmwkEwbSh7Nv6vVnXsnFhCz4G3VXnBt7y92gc7y2wu";

// === TELEGRAM ALERT ===
async function sendTelegramAlert(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    }),
  });
}

// === WEBSOCKET CONNECTION TO SOLANA ===
function connectWS() {
  console.log("🔌 Connecting to Solana RPC WebSocket...");
  const ws = new WebSocket(RPC_URL);

  ws.on("open", () => {
    console.log("✅ Connected to Solana WebSocket");
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "logsSubscribe",
        params: [
          { mentions: [MANGO_V4_PROGRAM] },
          { commitment: "confirmed" },
        ],
      })
    );
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg?.params?.result?.value?.logs) {
        const logs = msg.params.result.value.logs;
        const sig = msg.params.result.value.signature;

        for (let log of logs) {
          if (log.includes("Liquidate")) {
            console.log("🔥 Liquidation detected!", sig, log);
            await sendTelegramAlert(
              `🔥 Mango Liquidation Detected!\nTx: https://solscan.io/tx/${sig}\nLog: ${log}`
            );
          }
        }
      }
    } catch (err) {
      console.error("❌ Error parsing log:", err);
    }
  });

  ws.on("close", () => {
    console.log("⚠️ WebSocket closed. Reconnecting in 5s...");
    setTimeout(connectWS, 5000);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err.message);
    ws.close();
  });
}

// === EXPRESS SERVER ===
app.get("/", (req, res) => {
  res.send("✅ Mango Liquidation Tracker is running...");
});

app.listen(PORT, () => {
  console.log(`🌐 Server listening on port ${PORT}`);
  connectWS();
});
