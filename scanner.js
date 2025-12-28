// scanner.js

import axios from 'axios';

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ARBITRAGE_THRESHOLD_PERCENT = 3;
const MIN_LIQUIDITY_USD = 5000;

// *** HYBRID LIST: A list of popular tokens to search for ***
// This gives us broad coverage without using a single, broken endpoint.
const TOKENS_TO_SEARCH = [
  'SOL', 'BONK', 'WIF', 'JUP', 'RAY', 'RNDR', 'PEPE', 'POPCAT',
  'FIDA', 'SAMO', 'ORCA', 'MNGO', 'SRM', 'LDO', 'TNSR', 'PYTH'
  // Add more symbols as you see fit
];

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

// --- HYBRID Detection Logic ---

async function hybridSearchAndScan() {
  console.log(`--- [${new Date().toISOString()}] Starting hybrid search scan ---`);

  for (const tokenSymbol of TOKENS_TO_SEARCH) {
    try {
      console.log(`\nSearching for pairs containing: ${tokenSymbol}`);
      const response = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${tokenSymbol}`);
      const pairs = response.data.pairs;

      // Filter for quality pairs on Solana quoted in USDC/USDT
      const validPairs = pairs.filter(pair => 
        pair.chainId === 'solana' &&
        (pair.quoteToken.symbol === 'USDC' || pair.quoteToken.symbol === 'USDT') &&
        pair.liquidity?.usd > MIN_LIQUIDITY_USD
      );

      if (validPairs.length < 2) {
        console.log(`-> Not enough valid pairs for ${tokenSymbol}. Skipping.`);
        continue;
      }

      // Group these pairs by the base token to handle cases like SOL/USDC and SOL/USDT
      const tokenGroups = new Map();
      for (const pair of validPairs) {
        const baseTokenAddress = pair.baseToken.address;
        if (!tokenGroups.has(baseTokenAddress)) {
          tokenGroups.set(baseTokenAddress, []);
        }
        tokenGroups.get(baseTokenAddress).push(pair);
      }

      // Now analyze each grouped token
      for (const [baseTokenAddress, tokenPairs] of tokenGroups) {
        let minPrice = Infinity;
        let maxPrice = 0;
        let buyDex = null;
        let sellDex = null;

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

        if (minPrice !== Infinity && maxPrice > 0 && buyDex !== sellDex) {
          const priceDifference = maxPrice - minPrice;
          const percentDifference = (priceDifference / minPrice) * 100;

          if (percentDifference > ARBITRAGE_THRESHOLD_PERCENT) {
            const foundTokenSymbol = tokenPairs[0].baseToken.symbol;
            console.log(`🚨 Opportunity found for ${foundTokenSymbol}: ${percentDifference.toFixed(2)}% between ${buyDex} and ${sellDex}`);

            let message = `🚨 *Arbitrage Opportunity Detected!*\n\n`;
            message += `Token: *${foundTokenSymbol}*\n`;
            message += `Buy on: *${buyDex}* for $${minPrice.toFixed(6)}\n`;
            message += `Sell on: *${sellDex}* for $${maxPrice.toFixed(6)}\n\n`;
            message += `Potential Profit: *${percentDifference.toFixed(2)}%*`;

            await sendTelegramAlert(message);
          }
        }
      }

    } catch (error) {
      console.error(`Error scanning for ${tokenSymbol}:`, error.message);
    }
  }

  console.log("\n--- Hybrid search scan finished ---");
}

// --- Initialization ---
console.log("Starting HYBRID market scanner...");
// This scan makes multiple API calls, so let's give it a bit more time. 10 minutes.
setInterval(hybridSearchAndScan, 600000);
hybridSearchAndScan(); // Run once on startup
