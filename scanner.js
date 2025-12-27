// scanner.js

import axios from 'axios';

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ARBITRAGE_THRESHOLD_PERCENT = 0.5;
const MIN_LIQUIDITY_USD = 5000; // Lowered value

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

// --- DEBUGGING Detection Logic ---

async function debugScanForArbitrage() {
  console.log(`--- [${new Date().toISOString()}] Starting DEBUG scan ---`);

  try {
    // Let's try searching for a very common token: SOL
    console.log("Step 1: Fetching all pairs for 'SOL'...");
    const response = await axios.get('https://api.dexscreener.com/latest/dex/search?q=SOL');
    const allPairs = response.data.pairs;
    console.log(`-> API returned ${allPairs.length} total pairs for 'SOL'.`);

    // Filter for pairs on Solana chain
    console.log("Step 2: Filtering for pairs on Solana chain...");
    const solanaPairs = allPairs.filter(pair => pair.chainId === 'solana');
    console.log(`-> ${solanaPairs.length} pairs are on the Solana chain.`);

    // Filter for pairs with sufficient liquidity
    console.log(`Step 3: Filtering for pairs with > $${MIN_LIQUIDITY_USD} liquidity...`);
    const liquidPairs = solanaPairs.filter(pair => pair.liquidity?.usd && pair.liquidity.usd > MIN_LIQUIDITY_USD);
    console.log(`-> ${liquidPairs.length} pairs have sufficient liquidity.`);

    // Filter for pairs quoted in USDC or USDT
    console.log("Step 4: Filtering for pairs quoted in USDC or USDT...");
    const validPairs = liquidPairs.filter(pair => 
      pair.quoteToken.symbol === 'USDC' || pair.quoteToken.symbol === 'USDT'
    );
    console.log(`-> ${validPairs.length} pairs are quoted in USDC/USDT.`);

    // Group them by the base token
    console.log("Step 5: Grouping by base token address...");
    const tokenGroups = new Map();
    for (const pair of validPairs) {
      const baseTokenAddress = pair.baseToken.address;
      if (!tokenGroups.has(baseTokenAddress)) {
        tokenGroups.set(baseTokenAddress, []);
      }
      tokenGroups.get(baseTokenAddress).push(pair);
    }
    console.log(`-> Grouped into ${tokenGroups.size} unique tokens to analyze.`);

    // The rest of the logic is the same...
    for (const [tokenAddress, tokenPairs] of tokenGroups) {
      // ... (opportunity detection logic)
      // I'll keep it short for clarity, but it's the same as before
      let minPrice = Infinity; let maxPrice = 0; let buyDex = null; let sellDex = null;
      for (const pair of tokenPairs) { const price = parseFloat(pair.priceUsd); if (price < minPrice) { minPrice = price; buyDex = pair.dexId; } if (price > maxPrice) { maxPrice = price; sellDex = pair.dexId; } }
      if (minPrice !== Infinity && maxPrice > 0 && buyDex !== sellDex) { const percentDifference = ((maxPrice - minPrice) / minPrice) * 100; if (percentDifference > ARBITRAGE_THRESHOLD_PERCENT) { const tokenSymbol = tokenPairs[0].baseToken.symbol; console.log(`🚨 Opportunity found for ${tokenSymbol}: ${percentDifference.toFixed(2)}%`); await sendTelegramAlert(`Opportunity for ${tokenSymbol}: ${percentDifference.toFixed(2)}%`); } }
    }

    console.log("--- DEBUG scan finished ---");

  } catch (error) {
    console.error("Error during DEBUG scan:", error.message);
  }
}

// --- Initialization ---
console.log("Starting DEBUG market scanner...");
setInterval(debugScanForArbitrage, 300000);
debugScanForArbitrage();
