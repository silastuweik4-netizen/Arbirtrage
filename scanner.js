// scanner.js

import axios from 'axios';

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const SOL_MINT = "So11111111111111111111111111111111111111112";
const ARBITRAGE_THRESHOLD_PERCENT = 0.5; // Only alert if the difference is > 0.5%

// --- Notification Function ---

// A simple, surgical function to send a message to Telegram
async function sendTelegramAlert(message) {
  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(telegramUrl, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'Markdown'
    });
    console.log("✅ Alert sent to Telegram.");
  } catch (error) {
    console.error("Failed to send Telegram alert:", error.response?.data || error.message);
  }
}

// --- Detection Logic ---

// Function to get prices from Dexscreener API
async function getDexscreenerPrices() {
  try {
    const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`);
    const pairs = response.data.pairs;
    let raydiumPrice = null;
    let orcaPrice = null;
    for (const pair of pairs) {
      if (pair.dexId === 'raydium' && pair.quoteToken.symbol === 'USDC') {
        raydiumPrice = parseFloat(pair.priceUsd);
      }
      if (pair.dexId === 'orca' && pair.quoteToken.symbol === 'USDC') {
        orcaPrice = parseFloat(pair.priceUsd);
      }
    }
    return { raydiumPrice, orcaPrice };
  } catch (error) {
    console.error("Error fetching Dexscreener data:", error.message);
    return { raydiumPrice: null, orcaPrice: null };
  }
}

// The main arbitrage checking logic
async function checkArbitrage() {
  console.log(`--- [${new Date().toISOString()}] Checking for arbitrage... ---`);

  const { raydiumPrice, orcaPrice } = await getDexscreenerPrices();

  if (!raydiumPrice || !orcaPrice) {
    console.log("Could not retrieve prices from both DEXs.");
    return;
  }

  const priceDifference = raydiumPrice - orcaPrice;
  const percentDifference = (priceDifference / orcaPrice) * 100;

  console.log(`Raydium: $${raydiumPrice.toFixed(4)}, Orca: $${orcaPrice.toFixed(4)}, Diff: ${percentDifference.toFixed(2)}%`);

  if (Math.abs(percentDifference) > ARBITRAGE_THRESHOLD_PERCENT) {
    let message = `🚨 *Arbitrage Opportunity Detected!*\n\n`;
    message += `Raydium SOL Price: $${raydiumPrice.toFixed(4)}\n`;
    message += `Orca SOL Price: $${orcaPrice.toFixed(4)}\n\n`;
    message += `Difference: ${percentDifference.toFixed(2)}%`;

    // *** FUTURE INTEGRATION POINT ***
    // This is where you will add your MEV and Kamino logic.
    // For now, we just send the notification.
    // await executeKaminoFlashloanAndMEV(...);
    
    await sendTelegramAlert(message);
  } else {
    console.log("No significant opportunity found.");
  }
}

// --- Initialization ---

console.log("Starting lean arbitrage scanner...");

// Run the check every 5 minutes (300,000 milliseconds)
setInterval(checkArbitrage, 300000);

// Run it once immediately on startup
checkArbitrage();
