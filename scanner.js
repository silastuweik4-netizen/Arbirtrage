// scanner.js

import axios from 'axios';

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ARBITRAGE_THRESHOLD_PERCENT = 0.5;
const MIN_LIQUIDITY_USD = 5000;

// --- LIST OF TOKENS TO SCAN (Can be symbols or mint addresses) ---
const TOKENS_TO_SCAN = [
  'SOL', 'BONK', 'WIF', 'JUP', 'RAY', 'RNDR', 'PEPE', 'POPCAT', 'FIDA', 'SAMO', 'ORCA', 'MNGO', 'SRM', 'LDO', 'TNSR', 'PYTH',
  'JTO', 'DRIFT', 'HNT', 'MOBILE', 'dSOL', 'jitoSOL',
  'H8xQ6poBjB9DTPMDTKWzWPrnxu4bDEhybxiouF8Ppump' // PUMP token
];

// --- Notification Function ---
async function sendTelegramAlert(message) {
  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(telegramUrl, { chat_id: CHAT_ID, text: message, parse_mode: 'Markdown' });
    console.log("✅ Alert sent to Telegram.");
  } catch (error) {
    console.error("Failed to send Telegram alert:", error.response?.data || error.message);
  }
}

// --- CORRECTED DETECTION LOGIC ---

async function comprehensiveScan() {
  console.log(`--- [${new Date().toISOString()}] Starting COMPREHENSIVE scan ---`);
  const allValidPairs = [];

  for (const item of TOKENS_TO_SCAN) {
    try {
      let query = typeof item === 'string' ? item : item.mintAddress;
      console.log(`\nSearching for all pairs of: ${query}`);
      const response = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${query}`);
      const pairs = response.data.pairs;

      // *** KEY CHANGE: Filter for any pair on Solana with sufficient liquidity ***
      const validPairs = pairs.filter(pair => 
        pair.chainId === 'solana' &&
        pair.liquidity?.usd > MIN_LIQUIDITY_USD
      );
      
      console.log(`-> Found ${validPairs.length} valid pairs for ${query}.`);
      allValidPairs.push(...validPairs);

    } catch (error) {
      console.error(`Error searching for ${item}:`, error.message);
    }
  }

  // Group all collected pairs by the base token (e.g., all PUMP pairs go together)
  console.log(`\nGrouping ${allValidPairs.length} total pairs by base token...`);
  const tokenGroups = new Map();
  for (const pair of allValidPairs) {
    const baseTokenAddress = pair.baseToken.address;
    if (!tokenGroups.has(baseTokenAddress)) {
      tokenGroups.set(baseTokenAddress, []);
    }
    tokenGroups.get(baseTokenAddress).push(pair);
  }

  console.log(`Grouped into ${tokenGroups.size} unique tokens to analyze for arbitrage.`);
  
  // Analyze each token group for arbitrage
  for (const [tokenAddress, tokenPairs] of tokenGroups) {
    if (tokenPairs.length < 2) continue; // Need at least 2 pairs to arbitrage

    let minPrice = Infinity;
    let maxPrice = 0;
    let buyDex = null;
    let sellDex = null;

    // Find the pair with the lowest and highest price for the base token
    for (const pair of tokenPairs) {
      const price = parseFloat(pair.priceUsd); // Dexscreener conveniently provides a normalized USD price
      if (price < minPrice) {
        minPrice = price;
        buyDex = pair.dexId;
      }
      if (price > maxPrice) {
        maxPrice = price;
        sellDex = pair.dexId;
      }
    }

    // Calculate the opportunity
    if (minPrice !== Infinity && maxPrice > 0 && buyDex !== sellDex) {
      const percentDifference = ((maxPrice - minPrice) / minPrice) * 100;

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

  console.log("--- COMPREHENSIVE scan finished ---");
}

// --- Initialization ---
console.log("Starting COMPREHENSIVE market scanner...");
setInterval(comprehensiveScan, 600000); // Run every 10 minutes
comprehensiveScan(); // Run once on startup
