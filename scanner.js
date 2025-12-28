// scanner.js

import axios from 'axios';

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ARBITRAGE_THRESHOLD_PERCENT = 0.5;
const MIN_LIQUIDITY_USD = 5000;
const HIGH_CONFIDENCE_THRESHOLD = 1.5;
const MIN_LIQUIDITY_FOR_TRADE_USD = 50000;
const MIN_VOLUME_USD = 5000;

// *** NEW: CURATED LIST CONFIGURATION ***
const SOLFLARE_TOKEN_LIST_URL = 'https://raw.githubusercontent.com/solflare-wallet/token-list/main/tokens.json';

// --- Notification Function ---
async function sendTelegramAlert(message) {
  // ... (same as before)
}

// --- NEW: FETCH CURATED LIST ---
async function getCuratedTokenList() {
  try {
    console.log("Fetching curated token list from Solflare...");
    const response = await axios.get(SOLFLARE_TOKEN_LIST_URL);
    // Assuming the response is { data: [...] }
    return response.data.data || response.data; // Handle potential variations in API response
  } catch (error) {
    console.error("Failed to fetch curated list:", error.message);
    return []; // Return empty array on failure
  }
}

// --- COMPREHENSIVE SCAN WITH CURATED LIST ---

async function superHybridScan() {
  console.log(`--- [${new Date().toISOString()}] Starting scan with CURATED LIST ---`);
  
  // 1. Fetch our trusted list first
  const curatedTokens = await getCuratedTokenList();
  if (!curatedTokens || curatedTokens.length === 0) {
    console.log("Could not fetch curated list. Skipping scan.");
    return;
  }

  // 2. Use the curated list as our primary source
  const allValidPairs = [];
  for (const token of curatedTokens) {
    try {
      const mintAddress = token.address;
      console.log(`\nSearching for pairs of: ${token.symbol} (${mintAddress})`);
      const response = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${mintAddress}`);
      const pairs = response.data.pairs;

      const validPairs = pairs.filter(pair => 
        pair.chainId === 'solana' &&
        (pair.quoteToken.symbol === 'USDC' || pair.quoteToken.symbol === 'USDT') &&
        pair.liquidity?.usd > MIN_LIQUIDITY_USD
      );
      
      console.log(`-> Found ${validPairs.length} valid pairs for ${token.symbol}.`);
      allValidPairs.push(...validPairs);

    } catch (error) {
      console.error(`Error searching for ${token.symbol}:`, error.message);
    }
  }

  // 3. The rest of the logic (grouping, analysis, alerting) is IDENTICAL
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
    // ... (All analysis logic is the same)
  }

  console.log("--- Scan with CURATED LIST finished ---");
}

// --- Initialization ---
console.log("Starting market scanner with CURATED LIST...");
setInterval(superHybridScan, 600000);
superHybridScan();
