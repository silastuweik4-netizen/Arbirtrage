// scanner.js

import axios from 'axios';

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ARBITRAGE_THRESHOLD_PERCENT = 0.5;
const MIN_LIQUIDITY_USD = 5000;

// --- Notification Function ---
async function sendTelegramAlert(message) {
  // ... (same as before)
  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(telegramUrl, { chat_id: CHAT_ID, text: message, parse_mode: 'Markdown' });
    console.log("✅ Alert sent to Telegram.");
  } catch (error) {
    console.error("Failed to send Telegram alert:", error.response?.data || error.message);
  }
}

// --- RAW DATA DEBUGGING LOGIC ---

async function debugRawApiResponse() {
  console.log(`--- [${new Date().toISOString()}] Starting RAW DATA debug ---`);

  try {
    console.log("Fetching raw data for 'USDC'...");
    const response = await axios.get('https://api.dexscreener.com/latest/dex/search?q=USDC');
    const pairs = response.data.pairs;

    console.log(`-> API returned ${pairs.length} total pairs.`);

    // Let's just count how many Solana pairs are in the raw data
    let solanaPairCount = 0;
    for (const pair of pairs) {
      if (pair.chainId === 'solana') {
        solanaPairCount++;
      }
    }
    console.log(`-> Of those, ${solanaPairCount} are on the Solana chain.`);

    // NOW, let's log the first 5 Solana pairs to see their structure
    console.log("--- Logging first 5 Solana pairs from raw data ---");
    let loggedCount = 0;
    for (const pair of pairs) {
      if (pair.chainId === 'solana' && loggedCount < 5) {
        console.log(pair); // This will print the entire JSON object for the pair
        loggedCount++;
      }
    }
    console.log("--- End of raw data log ---");

    // The rest of the arbitrage logic can be paused for now
    console.log("--- RAW DATA debug finished ---");

  } catch (error) {
    console.error("Error during raw data debug:", error.message);
  }
}

// --- Initialization ---
console.log("Starting RAW DATA debugger...");
// We will run this once manually. No interval needed for debugging.
debugRawApiResponse();
