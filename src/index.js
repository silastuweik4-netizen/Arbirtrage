import express from 'express';
import WebSocket from 'ws';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 10000;

// === CONFIG ===
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RPC_URL = 'wss://api.mainnet-beta.solana.com';
const SOLEND_PROGRAM = 'So11111111111111111111111111111111111111112';

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  process.exit(1);
}

// === TELEGRAM ALERT FUNCTION ===
async function sendTelegramAlert(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Telegram API error: ${response.status} ${errorText}`);
    }
    console.log('✅ Telegram alert sent.');
  } catch (err) {
    console.error('❌ Telegram error:', err);
  }
}

// === SOLANA WEBSOCKET ===
let retryCount = 0;
const MAX_RETRY_DELAY = 60000;

function connectWS() {
  console.log('🔌 Connecting to Solana RPC WebSocket...');
  const ws = new WebSocket(RPC_URL);

  ws.on('open', () => {
    console.log('✅ Connected to Solana WebSocket');
    retryCount = 0;

    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        { mentions: [SOLEND_PROGRAM] },
        { commitment: 'confirmed' }
      ]
    }));
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const logs = msg?.params?.result?.value?.logs;
      const sig = msg?.params?.result?.value?.signature;

      if (logs && sig) {
        let instrType = null;
        let borrower = null;
        let token = null;
        let amount = null;

        for (const log of logs) {
          if (log.includes('Instruction: LiquidateObligation')) instrType = 'LiquidateObligation';
          if (log.includes('Borrower:')) borrower = log.split('Borrower:')[1].trim();
          if (log.includes('Token:')) token = log.split('Token:')[1].trim();
          if (log.includes('Amount:')) amount = log.split('Amount:')[1].trim();
        }

        if (instrType && borrower) {
          const message = `🔥 *Solend Liquidation Detected!*\n\n- Instruction: ${instrType}\n- Borrower: \`${borrower}\`\n- Token: ${token || 'N/A'}\n- Amount: ${amount || 'N/A'}\n- Tx: https://solscan.io/tx/${sig}`;
          console.log(message);
          await sendTelegramAlert(message);
        }
      }
    } catch (err) {
      console.error('❌ Error processing WS message:', err);
    }
  });

  ws.on('close', (code, reason) => {
    console.warn(`⚠️ WebSocket closed (code ${code})`);
    retryCount++;
    const delay = Math.min(Math.pow(2, retryCount) * 1000, MAX_RETRY_DELAY);
    console.log(`⚠️ Reconnecting in ${delay / 1000}s... (Attempt ${retryCount})`);
    setTimeout(connectWS, delay);
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err.message);
  });
}

// === EXPRESS SERVER ===
app.get('/', (req, res) => {
  res.send('✅ Solend Liquidation Tracker is running...');
});

app.listen(PORT, () => {
  console.log(`🌐 Server listening on port ${PORT}`);
  connectWS();
});
