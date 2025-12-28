// scanner.js

import axios from 'axios';

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ARBITRAGE_THRESHOLD_PERCENT = 0.5;
const MIN_LIQUIDITY_USD = 5000;

// *** NEW: DRY RUN MODE ***
// Set this to 'true' in your Render Environment variables to enable dry run.
// When 'true', the bot will NOT send Telegram alerts. It will only log what it *would have done*.
const DRY_RUN = process.env.DRY_RUN === 'true';

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

// --- COMPREHENSIVE SCAN WITH PROFIT ANALYSIS ---

async function superHybridScan() {
  console.log(`--- [${new Date().toISOString()}] Starting SUPER HYBRID scan (Dry Run: ${DRY_RUN}) ---`);
  const allValidPairs = [];
  const allSearches = [...MINTS_TO_SEARCH, ...SYMBOLS_TO_SEARCH];

  for (const item of allSearches) {
    try {
      let query;
      if (typeof item === 'string') {
        query = item;
      } else {
        query = item.mintAddress;
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
      const percentDifference = ((maxPrice - minPrice) / minPrice) * 100;

      if (percentDifference > ARBITRAGE_THRESHOLD_PERCENT) {
        const tokenSymbol = tokenPairs[0].baseToken.symbol;
        console.log(`Opportunity found for ${tokenSymbol}: ${percentDifference.toFixed(2)}%`);

        // *** NEW: Use the profitability calculator ***
        const tradeSize = 10000;
        const { netProfit, netProfitPercent } = calculateNetProfit(minPrice, maxPrice, tradeSize);
        
        let isHighConfidence = false;
        if (percentDifference > HIGH_CONFIDENCE_THRESHOLD) {
          isHighConfidence = true;
        }
        
        // Check if both sides have enough liquidity for a real trade
        let liquidityCheckPassed = false;
        let buyLiquidity = buyPair?.liquidity?.usd || 0;
        let sellLiquidity = sellPair?.liquidity?.usd || 0;
        if (buyLiquidity > MIN_LIQUIDITY_FOR_TRADE_USD && sellLiquidity > MIN_LIQUIDITY_FOR_TRADE_USD) {
          liquidityCheckPassed = true;
        }
        
        let volumeCheckPassed = false;
        let sellVolume = sellPair?.volume?.h24 || 0;
        if (sellVolume > MIN_VOLUME_USD) {
          volumeCheckPassed = true;
        }
        
        // *** NEW: Check for DRY RUN mode before sending an alert ***
        if (DRY_RUN) {
          console.log(`🧪 DRY RUN: Would execute trade for ${tokenSymbol} with a ${netProfitPercent.toFixed(2)}% net profit.`);
        } else {
          // This is the normal alert path for production
          console.log(`🔥 HIGH-CONFIDENCE Opportunity for ${tokenSymbol}. Net Profit: ${netProfitPercent.toFixed(2)}%`);
          let message = `🔥 **HIGH-CONFIDENCE Opportunity!**\n\n`;
          message += `Token: *${tokenSymbol}*\n`;
          message += `Gross Spread: *${percentDifference.toFixed(2)}%*\n`;
          message += `Estimated Net Profit: *${netProfitPercent.toFixed(2)}%*\n\n`;
          message += `Buy: *${buyDex}*, Sell: *${sellDex}*`;
          await sendTelegramAlert(message);
        }
      }
    }
  }
  console.log("--- SUPER HYBRID scan finished ---");
}

// --- Initialization ---
console.log(`Starting SUPER HYBRID market scanner (Dry Run: ${DRY_RUN})...`);
setInterval(superHybridScan, 600000);
superHybridScan();
