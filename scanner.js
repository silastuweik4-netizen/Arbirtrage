// scanner.js

import axios from 'axios';

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ARBITRAGE_THRESHOLD_PERCENT = 0.5;
const MIN_LIQUIDITY_USD = 5000;

// *** SEARCH BY MINT ADDRESS: This is the key! ***
// Using the official mint addresses for popular stablecoins.
const MINTS_TO_SEARCH = [
  { symbol: 'USDC', mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  { symbol: 'USDT', mintAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' }
  // You can add more, like USDr, PYUSD, etc.
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

// --- MINT ADDRESS DETECTION LOGIC ---

async function scanByMintAddress() {
  console.log(`--- [${new Date().toISOString()}] Starting scan by mint address ---`);

  // We'll collect all valid pairs from all our mint searches here
  const allValidPairs = [];

  for (const stablecoin of MINTS_TO_SEARCH) {
    try {
      console.log(`\nSearching for pairs with mint address: ${stablecoin.symbol}...`);
      const response = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${stablecoin.mintAddress}`);
      const pairs = response.data.pairs;

      console.log(`-> Found ${pairs.length} pairs for ${stablecoin.symbol}.`);

      // Filter for pairs on Solana with sufficient liquidity
      const validPairs = pairs.filter(pair => 
        pair.chainId === 'solana' &&
        pair.liquidity?.usd > MIN_LIQUIDITY_USD
      );
      
      console.log(`-> ${validPairs.length} pairs are on Solana with sufficient liquidity.`);
      allValidPairs.push(...validPairs);

    } catch (error) {
      console.error(`Error searching for ${stablecoin.symbol}:`, error.message);
    }
  }

  // Now, group all the collected pairs by the base token
  console.log(`\nGrouping ${allValidPairs.length} total pairs by base token...`);
  const tokenGroups = new Map();
  for (const pair of allValidPairs) {
    // We want to find arbitrage between two different DEXes for the same token
    const baseTokenAddress = pair.baseToken.address;
    if (!tokenGroups.has(baseTokenAddress)) {
      tokenGroups.set(baseTokenAddress, []);
    }
    tokenGroups.get(baseTokenAddress).push(pair);
  }

  console.log(`Grouped into ${tokenGroups.size} unique tokens to analyze for arbitrage.`);

  // The rest of the arbitrage analysis logic is the same
  for (const [tokenAddress, tokenPairs] of tokenGroups) {
    if (tokenPairs.length < 2) continue; // Need at least 2 DEXes to arbitrage

    let minPrice = Infinity; let maxPrice = 0; let buyDex = null; let sellDex = null;
    for (const pair of tokenPairs) { const price = parseFloat(pair.priceUsd); if (price < minPrice) { minPrice = price; buyDex = pair.dexId; } if (price > maxPrice) { maxPrice = price; sellDex = pair.dexId; } }
    if (minPrice !== Infinity && maxPrice > 0 && buyDex !== sellDex) { const percentDifference = ((maxPrice - minPrice) / minPrice) * 100; if (percentDifference > ARBITRAGE_THRESHOLD_PERCENT) { const tokenSymbol = tokenPairs[0].baseToken.symbol; console.log(`🚨 Opportunity found for ${tokenSymbol}: ${percentDifference.toFixed(2)}%`); await sendTelegramAlert(`Opportunity for ${tokenSymbol}: ${percentDifference.toFixed(2)}%`); } }
  }

  console.log("--- Mint address scan finished ---");
}

// --- Initialization ---
console.log("Starting MINT ADDRESS market scanner...");
// This scan is more comprehensive, let's give it 10 minutes.
setInterval(scanByMintAddress, 600000);
scanByMintAddress(); // Run once on startup
