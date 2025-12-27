// scanner.js

import axios from 'axios';

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ARBITRAGE_THRESHOLD_PERCENT = 0.5;
const MIN_LIQUIDITY_USD = 5000; // A better value for finding mid-cap opportunities

// --- Notification Function ---
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

// --- FINAL Detection Logic: The Correct Chain Endpoint ---

// The main function that scans the Solana chain for arbitrage
async function scanSolanaChainForArbitrage() {
  console.log(`--- [${new Date().toISOString()}] Starting Solana chain scan (Corrected URL) ---`);

  try {
    // 1. Fetch all pairs on the Solana chain using the correct URL
    const response = await axios.get('https://api.dexscreener.com/latest/dex/pairs/solana');
    const pairs = response.data.pairs;

    console.log(`API returned ${pairs.length} pairs on Solana.`);

    // 2. Filter for quality pairs and group them by the base token
    const tokenGroups = new Map();
    for (const pair of pairs) {
      // We only want pairs quoted in USDC or USDT for a fair comparison
      const isStablecoinQuoted = pair.quoteToken.symbol === 'USDC' || pair.quoteToken.symbol === 'USDT';
      const hasLiquidity = pair.liquidity?.usd && pair.liquidity.usd > MIN_LIQUIDITY_USD;

      if (isStablecoinQuoted && hasLiquidity) {
        const baseTokenAddress = pair.baseToken.address;
        if (!tokenGroups.has(baseTokenAddress)) {
          tokenGroups.set(baseTokenAddress, []);
        }
        tokenGroups.get(baseTokenAddress).push(pair);
      }
    }

    console.log(`Found ${tokenGroups.size} tokens on Solana to analyze after filtering.`);

    // 3. Analyze each token group for arbitrage
    for (const [tokenAddress, tokenPairs] of tokenGroups) {
      let minPrice = Infinity;
      let maxPrice = 0;
      let buyDex = null;
      let sellDex = null;

      // Find the best buy and sell prices for this token
      for (const pair of tokenPairs) {
        const price = parseFloat(pair.priceUsd);
        if (price < minPrice) {
          minPrice = price;
          buyDex = pair.dexId;
        }
        if (price > maxPrice) {
          maxPrice = price;
          sellDex = pair.dexId;
        }
      }

      // 4. Calculate the opportunity
      if (minPrice !== Infinity && maxPrice > 0 && buyDex !== sellDex) {
        const priceDifference = maxPrice - minPrice;
        const percentDifference = (priceDifference / minPrice) * 100;

        // 5. Check if it meets our threshold and alert
        if (percentDifference > ARBITRAGE_THRESHOLD_PERCENT) {
          const tokenSymbol = tokenPairs[0].baseToken.symbol;
          console.log(`🚨 Opportunity found for ${tokenSymbol}: ${percentDifference.toFixed(2)}% between ${buyDex} and ${sellDex}`);

          let message = `🚨 *Arbitrage Opportunity Detected!*\n\n`;
          message += `Token: *${tokenSymbol}*\n`;
          message += `Buy on: *${buyDex}* for $${minPrice.toFixed(6)}\n`;
          message += `Sell on: *${sellDex}* for $${maxPrice.toFixed(6)}\n\n`;
          message += `Potential Profit: *${percentDifference.toFixed(2)}%*`;

          await sendTelegramAlert(message);
        }
      }
    }

    console.log("--- Solana chain scan finished ---");

  } catch (error) {
    console.error("Error during Solana chain scan:", error.message);
  }
}

// --- Initialization ---
console.log("Starting Solana chain scanner (Corrected URL)...");
setInterval(scanSolanaChainForArbitrage, 300000); // Run every 5 minutes
scanSolanaChainForArbitrage(); // Run once on startup
