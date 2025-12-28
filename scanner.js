// scanner.js

import axios from 'axios';

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ARBITRAGE_THRESHOLD_PERCENT = 0.5;
const MIN_LIQUIDITY_USD = 5000;

// --- PART 1: STABLECOIN MINT ADDRESSES ---
const MINTS_TO_SEARCH = [
  { symbol: 'USDC', mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  { symbol: 'USDT', mintAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' }
];

// --- PART 2: POPULAR BASE TOKEN SYMBOLS ---
const SYMBOLS_TO_SEARCH = [
  'SOL', 'BONK', 'WIF', 'JUP', 'RAY', 'RNDR', 'PEPE', 'POPCAT', 'FIDA', 'SAMO', 'ORCA', 'MNGO', 'SRM', 'LDO', 'TNSR', 'PYTH'
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

// --- CORRECTED SUPER HYBRID DETECTION LOGIC ---

async function superHybridScan() {
  console.log(`--- [${new Date().toISOString()}] Starting SUPER HYBRID scan ---`);
  const allValidPairs = [];
  const allSearches = [...MINTS_TO_SEARCH, ...SYMBOLS_TO_SEARCH];

  for (const item of allSearches) {
    try {
      // *** BUG FIX HERE: Check the type of item to get the correct query ***
      let query;
      if (typeof item === 'string') {
        query = item; // It's a symbol from SYMBOLS_TO_SEARCH
      } else {
        query = item.mintAddress; // It's an object from MINTS_TO_SEARCH
      }
      
      console.log(`\nSearching for: ${query}`);
      const response = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${query}`);
      const pairs = response.data.pairs;

      const validPairs = pairs.filter(pair => 
        pair.chainId === 'solana' &&
        (pair.quoteToken.symbol === 'USDC' || pair.quoteToken.symbol === 'USDT') &&
        pair.liquidity?.usd > MIN_LIQUIDITY_USD
      );
      
      console.log(`-> Found ${validPairs.length} valid pairs for ${query}.`);
      allValidPairs.push(...validPairs);

    } catch (error) {
      console.error(`Error searching for ${item.symbol || item}:`, error.message);
    }
  }

  // Use a Map to automatically handle duplicates and group by base token
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
  
  // The rest of the arbitrage analysis logic is the same
  for (const [tokenAddress, tokenPairs] of tokenGroups) {
    if (tokenPairs.length < 2) continue; // Need at least 2 DEXes

    let minPrice = Infinity; let maxPrice = 0; let buyDex = null; let sellDex = null;
    for (const pair of tokenPairs) { const price = parseFloat(pair.priceUsd); if (price < minPrice) { minPrice = price; buyDex = pair.dexId; } if (price > maxPrice) { maxPrice = price; sellDex = pair.dexId; } }
    if (minPrice !== Infinity && maxPrice > 0 && buyDex !== sellDex) { const percentDifference = ((maxPrice - minPrice) / minPrice) * 100; if (percentDifference > ARBITRAGE_THRESHOLD_PERCENT) { const tokenSymbol = tokenPairs[0].baseToken.symbol; console.log(`🚨 Opportunity found for ${tokenSymbol}: ${percentDifference.toFixed(2)}%`); await sendTelegramAlert(`Opportunity for ${tokenSymbol}: ${percentDifference.toFixed(2)}%`); } }
  }

  console.log("--- SUPER HYBRID scan finished ---");
}

// --- Initialization ---
console.log("Starting SUPER HYBRID market scanner...");
setInterval(superHybridScan, 600000); // Run every 10 minutes
superHybridScan(); // Run once on startup
