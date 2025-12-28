// scanner.js

import axios from 'axios';

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ARBITRAGE_THRESHOLD_PERCENT = 0.5; // For logging
const HIGH_CONFIDENCE_THRESHOLD = 2.5; // For loud alerts
const MIN_LIQUIDITY_USD = 5000;
const MIN_LIQUIDITY_FOR_TRADE_USD = 50000; // Both sides must have this for a high-confidence alert
const MIN_VOLUME_USD = 10000; // *** NEW: The sell-side must have this much volume

// --- LIST OF TOKENS TO SCAN ---
const TOKENS_TO_SCAN = [
  'SOL', 'BONK', 'WIF', 'JUP', 'RAY', 'RNDR', 'PEPE', 'POPCAT', 'FIDA', 'SAMO', 'ORCA', 'MNGO', 'SRM', 'LDO', 'TNSR', 'PYTH',
  'JTO', 'DRIFT', 'HNT', 'MOBILE', 'dSOL', 'jitoSOL',
  'H8xQ6poBjB9DTPMDTKWzWPrnxu4bDEhybxiouF8Ppump'
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

// --- COMPREHENSIVE SCAN WITH VOLUME VALIDATION ---

async function comprehensiveScan() {
  console.log(`--- [${new Date().toISOString()}] Starting COMPREHENSIVE scan ---`);
  const allValidPairs = [];

  for (const item of TOKENS_TO_SCAN) {
    try {
      let query = typeof item === 'string' ? item : item.mintAddress;
      console.log(`\nSearching for all pairs of: ${query}`);
      const response = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${query}`);
      const pairs = response.data.pairs;

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
  
  for (const [tokenAddress, tokenPairs] of tokenGroups) {
    if (tokenPairs.length < 2) continue;

    let minPrice = Infinity; let maxPrice = 0; let buyDex = null; let sellDex = null;
    let buyPair = null; let sellPair = null; // *** NEW: Store the pair objects

    for (const pair of tokenPairs) {
      const price = parseFloat(pair.priceUsd);
      if (price < minPrice) {
        minPrice = price;
        buyDex = pair.dexId;
        buyPair = pair; // *** NEW: Store the object
      }
      if (price > maxPrice) {
        maxPrice = price;
        sellDex = pair.dexId;
        sellPair = pair; // *** NEW: Store the object
      }
    }

    if (minPrice !== Infinity && maxPrice > 0 && buyDex !== sellDex) {
      const percentDifference = ((maxPrice - minPrice) / minPrice) * 100;

      if (percentDifference > ARBITRAGE_THRESHOLD_PERCENT) {
        const tokenSymbol = tokenPairs[0].baseToken.symbol;
        console.log(`Opportunity found for ${tokenSymbol}: ${percentDifference.toFixed(2)}%`);

        // *** NEW VALIDATION LOGIC HERE ***
        let isHighConfidence = false;
        if (percentDifference > HIGH_CONFIDENCE_THRESHOLD) {
          isHighConfidence = true;
        }

        // Check if both sides have enough liquidity for a real trade
        let liquidityCheckPassed = false;
        if (buyPair && sellPair && buyPair.liquidity?.usd > MIN_LIQUIDITY_FOR_TRADE_USD && sellPair.liquidity?.usd > MIN_LIQUIDITY_FOR_TRADE_USD) {
          liquidityCheckPassed = true;
        }

        // *** NEW: Check if the SELL side has enough volume ***
        let volumeCheckPassed = false;
        if (sellPair && sellPair.volume?.h24 && parseFloat(sellPair.volume.h24) > MIN_VOLUME_USD) {
          volumeCheckPassed = true;
        }
        
        // Only send a loud alert if it's high-confidence AND passes ALL checks
        if (isHighConfidence && liquidityCheckPassed && volumeCheckPassed) {
          console.log(`🔥 HIGH-CONFIDENCE Opportunity for ${tokenSymbol}: ${percentDifference.toFixed(2)}% - All checks passed!`);
          let message = `🔥 **HIGH-CONFIDENCE Opportunity!**\n\n`;
          message += `Token: *${tokenSymbol}*\n`;
          message += `Spread: *${percentDifference.toFixed(2)}%*\n`;
          message += `Buy: *${buyDex}* (Vol: $${(buyPair.volume?.h24 || 0).toLocaleString()})\n`;
          message += `Sell: *${sellDex}* (Vol: $${(sellPair.volume?.h24 || 0).toLocaleString()})`;
          await sendTelegramAlert(message);
        } else {
          console.log(`-> Opportunity ${tokenSymbol} filtered out. Confidence: ${isHighConfidence}, Liquidity: ${liquidityCheckPassed}, Volume: ${volumeCheckPassed}`);
        }
      }
    }
  }
  console.log("--- COMPREHENSIVE scan finished ---");
}

// --- Initialization ---
console.log("Starting COMPREHENSIVE market scanner with VOLUME validation...");
setInterval(comprehensiveScan, 600000); // Run every 10 minutes
comprehensiveScan();
