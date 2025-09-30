import express from 'express';
import WebSocket from 'ws';
import fetch from 'node-fetch';
import { Connection, PublicKey } from '@solana/web3.js';

// === Configuration ===
const app = express();
const PORT = process.env.PORT || 10000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RPC_URL_HTTP = 'https://api.mainnet-beta.solana.com'; // Use HTTP for the main RPC connection
const RPC_URL_WS = 'wss://api.mainnet-beta.solana.com'; // Use WSS for the websocket subscription
const SOLEND_PROGRAM_ID = new PublicKey('So11111111111111111111111111111111111111112');

// Exit if required environment variables are missing
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  process.exit(1);
}

// Global handler for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // You might want to implement a more robust logging or alert system here
});

// === Telegram Alert Function ===
async function sendTelegramAlert(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
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

// === Solana WebSocket ===
let solendSubscriptionId = null;
let connection = null;

function connectToSolana() {
  console.log('🔌 Connecting to Solana RPC WebSocket...');
  
  // Create a Connection with both the HTTP endpoint for RPC calls
  // and the WebSocket endpoint for subscriptions.
  connection = new Connection(RPC_URL_HTTP, { wsEndpoint: RPC_URL_WS });

  connection.onLogs(
    SOLEND_PROGRAM_ID,
    (logResult, context) => {
      handleLogMessage(logResult, context).catch(err => {
        console.error('❌ Error in handleLogMessage:', err);
      });
    },
    'confirmed'
  ).then(id => {
    solendSubscriptionId = id;
    console.log('✅ Subscribed to Solend logs with ID:', id);
  }).catch(err => {
    console.error('❌ Failed to subscribe to Solend logs:', err);
    // Implement reconnection logic here for subscription failure
  });

  // Basic health check to catch connection issues
  connection.getSlot().then(slot => {
    console.log(`📡 Connection healthy, current slot: ${slot}`);
  }).catch(err => {
    console.error('❌ Connection health check failed:', err);
    // You could re-connect here if needed
  });
}

async function handleLogMessage(logResult, context) {
  const { logs, signature } = logResult;

  if (logs) {
    // Check if the liquidation instruction log exists before proceeding
    const liquidationLog = logs.find(log => log.includes('Instruction: LiquidateObligation'));

    if (liquidationLog) {
      // Improved parsing using regex for robustness
      // Use logs.join('\n') to treat all logs as a single string for pattern matching
      const allLogs = logs.join('\n');
      const borrowerMatch = allLogs.match(/Borrower:\s*(\w+)/);
      const tokenMatch = allLogs.match(/Token:\s*(\w+)/);
      const amountMatch = allLogs.match(/Amount:\s*([\d.]+)/);

      const borrower = borrowerMatch ? borrowerMatch[1] : 'N/A';
      const token = tokenMatch ? tokenMatch[1] : 'N/A';
      const amount = amountMatch ? amountMatch[1] : 'N/A';

      const message = `🔥 *Solend Liquidation Detected!*
      
- Instruction: \`LiquidateObligation\`
- Borrower: \`${borrower}\`
- Token: ${token}
- Amount: ${amount}
- Tx: https://solscan.io/tx/${signature}`;

      console.log(message);
      await sendTelegramAlert(message);
    }
  }
}

// === Express Server ===
app.get('/', (req, res) => {
  res.send('✅ Solend Liquidation Tracker is running...');
});

app.listen(PORT, () => {
  console.log(`🌐 Server listening on port ${PORT}`);
  connectToSolana();
});

