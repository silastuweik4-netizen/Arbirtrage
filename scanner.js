// scanner.js

import axios from 'axios';

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ARBITRAGE_THRESHOLD_PERCENT = 0.5; // For logging
const HIGH_CONFIDENCE_THRESHOLD = 1.5; // For loud alerts
const MIN_LIQUIDITY_USD = 5000;
const MIN_LIQUIDITY_FOR_TRADE_USD = 50000;
const MIN_VOLUME_USD = 5000;

// --- MASTER LIST OF TOKENS (Using precise contract addresses) ---
const TOKENS_TO_SCAN = [
  { symbol: 'SOL', address: 'So11111111111111111111111111111111111111111112' },
  { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  { symbol: 'BONK', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
  { symbol: 'WIF', address: 'EKpQGSJtjMFqKZ9KuhCm7pD6yFCN1uehXcTqLpYcDhUv' },
  { symbol: 'JUP', address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
  { symbol: 'RAY', address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R' },
  { symbol: 'PEPE', address: '2RrkwH4Nfv3f8mz2F4J1GzZkGXb5v9wY9iFGKN' },
  { symbol: 'POPCAT', address: '7GCihgDB8fe6KNAb2Mfc8rLhgzv24TcGhTQ' },
  { symbol: 'FIDA', address: 'E1qy9hqJ9pzA6aGjFTdu1aH9g6Wcy1tCL1' },
  { symbol: 'SAMO', address: '7xKXtg2CW87d97TXJSD2pCvJsm7V12k4UnBy' },
  { symbol: 'ORCA', address: 'orcaEKTdK8vXnnDE8aJNpvyVzDkT2YbN66T' },
  { symbol: 'MNGO', address: 'MangoCzJ36AjZynNb9vKEo9STpUStLJLmTJ7fP' },
  { symbol: 'SRM', address: 'SRMuApVNdxXokc5wD5nVHd9KRKiAZKv6Csmc' },
  { symbol: 'LDO', address: 'LAzerdJqy8ULb9gCzAaDjCkM5fDy1xXJzF5' },
  { symbol: 'TNSR', address: 'D1aLN4jVQguRDSS4Q1f2rLsEPLhJ6GJ5K6' },
  { symbol: 'PYTH', address: 'PythL8abKUeP2gZjU9VjB4o4dCH7rUaRN3zdvHy3' },
  { symbol: 'JTO', address: 'jtojtym9e2dGvBd91D6wr1eAEgzePJ7rEa3g' },
  { symbol: 'DRIFT', address: 'DR1FTbuRPLVzU9dWsdW2wDyFh5Dn9nXeGNB' },
  { symbol: 'HNT', address: 'hntyVPKtHWKtVdJBgtV7FhQe3vCNJwXw' },
  { symbol: 'MOBILE', address: 'mobaNBzFdf2p3aT7j8HbNfPmnB3s1wU9' },
  { symbol: 'dSOL', address: 'D1CeuKsVvCazrR2G12wUQJ9SofYf3R3K' },
  { symbol: 'jitoSOL', address: 'J1toso1uCk3KjCUti9LwAZKg5zA9M6CY2Mc' },
  { symbol: 'PUMP', address: 'H8xQ6poBjB9DTPMDTKWzWPrnxu4bDEhybxiouF8Ppump' }
];

// --- Notification Function ---
async function sendTelegramAlert(message) {
  // ... (same as before)
}

// --- COMPREHENSIVE SCAN USING ADDRESSES ---

async function comprehensiveScan() {
  console.log(`--- [${new Date().toISOString()}] Starting COMPREHENSIVE scan ---`);
  const allValidPairs = [];

  for (const token of TOKENS_TO_SCAN) {
    try {
      // *** KEY CHANGE: Use the 'address' field from our new object ***
      const query = token.address;
      console.log(`\nSearching for all pairs of: ${token.symbol} (${query})`);
      const response = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${query}`);
      const pairs = response.data.pairs;

      const validPairs = pairs.filter(pair => 
        pair.chainId === 'solana' &&
        pair.liquidity?.usd > MIN_LIQUIDITY_USD
      );
      
      console.log(`-> Found ${validPairs.length} valid pairs for ${token.symbol}.`);
      allValidPairs.push(...validPairs);

    } catch (error) {
      console.error(`Error searching for ${token.symbol}:`, error.message);
    }
  }

  // ... (The rest of the grouping and analysis logic is identical)
}

// --- Initialization ---
console.log("Starting COMPREHENSIVE market scanner using ADDRESSES...");
setInterval(comprehensiveScan, 600000);
comprehensiveScan();
