/*  arb.js  –  WBTC/USDC spread watcher with Quoter V2 and profitability check  */
require('dotenv').config();
const ethers = require('ethers');
const { notify } = require('./bot');
const config = require('./config.json');

/* ----------  CONFIGURATION & SETUP  ---------- */

// Arbitrum One Chain ID
const ARBITRUM_CHAIN_ID = 42161;

// Quoter V2 Address on Arbitrum
const QUOTER_V2_ADDRESS = "0x61fFe014bA17989E743c5F6CB21bf9697530B21e".toLowerCase();

// Token Addresses on Arbitrum
const WBTC = "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f".toLowerCase();
const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831".toLowerCase();

// Quoter V2 ABI for price fetching
const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 feeTier, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
];

/* ----------  RPCs / PROVIDER  ---------- */
let rpcIndex = 0;

// Function to get a provider instance using the current RPC URL
function getProvider() {
  const rpcUrl = config.rpcList[rpcIndex];
  // Use StaticJsonRpcProvider to fix "could not detect network" error
  return new ethers.providers.StaticJsonRpcProvider(rpcUrl, ARBITRUM_CHAIN_ID);
}

// Function to cycle RPCs if one fails
function cycleRpc() {
    rpcIndex = (rpcIndex + 1) % config.rpcList.length;
    console.warn(`Switched to next RPC endpoint: ${config.rpcList[rpcIndex]}`);
}

/* ----------  PRICE CALL WITH QUOTER V2  ---------- */
async function getPrice(feeTier, retries = 2) {
  try {
    const provider = getProvider();
    const quoter = new ethers.Contract(QUOTER_V2_ADDRESS, QUOTER_ABI, provider);

    // Fetch price for 1 WBTC (8 decimals)
    const amountIn = ethers.utils.parseUnits("1", 8);

    // Use callStatic to simulate the transaction and get the return value
    const quote = await quoter.callStatic.quoteExactInputSingle({
      tokenIn: WBTC,
      tokenOut: USDC,
      amountIn: amountIn,
      feeTier: feeTier,
      sqrtPriceLimitX96: 0
    });

    // Amount out is in USDC (6 decimals)
    return parseFloat(ethers.utils.formatUnits(quote.amountOut, 6));

  } catch (e) {
    if (retries > 0) {
      console.warn(`RPC fail: ${e.message.substring(0, 50)}...`);
      cycleRpc(); // Switch to the next RPC
      await new Promise(resolve => setTimeout(resolve, 1000)); // Short delay
      return getPrice(feeTier, retries - 1);
    }
    console.error(`Failed to get price for fee tier ${feeTier} after all retries.`);
    throw e;
  }
}

/* ----------  PROFITABILITY ESTIMATION  ---------- */
async function isProfitable(priceA, priceB) {
  try {
    const provider = getProvider();
    const gasPrice = await provider.getGasPrice();
    const gasLimit = config.trade.estimatedGasLimit;
    const gasCostWei = gasPrice.mul(gasLimit);
    const gasCostEth = parseFloat(ethers.utils.formatEther(gasCostWei));
    const gasCostInUsdc = gasCostEth * config.trade.ethPriceInUsdc;

    const grossProfit = (Math.abs(priceA - priceB) / Math.max(priceA, priceB)) * config.trade.tradeSizeUSD;
    const slippageCost = (config.trade.estimatedSlippagePercent / 100) * config.trade.tradeSizeUSD;
    
    const totalCosts = gasCostInUsdc + slippageCost;
    const netProfit = grossProfit - totalCosts;

    console.log(`Profitability Check: Net Profit: $${netProfit.toFixed(2)} (Gross: $${grossProfit.toFixed(2)}, Costs: $${totalCosts.toFixed(2)})`);

    return netProfit > 0;
  } catch (e) {
    console.error('Could not estimate profitability:', e.message);
    return false;
  }
}

/* ----------  HELPERS  ---------- */
function pct(a, b) { return Math.abs(a / b - 1) * 100; }

/* ----------  SCAN  ---------- */
async function scan() {
  try {
    console.log(`[${new Date().toISOString()}] Scanning for spread opportunities...`);
    
    // Use fee tiers from config
    const feeA = config.pools.poolA.fee;
    const feeB = config.pools.poolB.fee;

    const [priceA, priceB] = await Promise.all([getPrice(feeA), getPrice(feeB)]);
    const spread = pct(priceA, priceB);

    if (spread < config.thresholds.spreadPercent) {
      console.log(`Spread is ${spread.toFixed(4)}%, below threshold of ${config.thresholds.spreadPercent}%.`);
      return;
    }

    console.log(`🚨 Potential spread detected: ${spread.toFixed(2)}%`);

    const profitable = await isProfitable(priceA, priceB);

    if (!profitable) {
      console.log(`Spread of ${spread.toFixed(2)}% is not profitable after estimated costs.`);
      return;
    }
    
    const provider = getProvider();
    const block = await provider.getBlockNumber();
    const msg = `💰 Profitable WBTC/USDC spread: ${spread.toFixed(2)}%\n` +
                `Pool A (Fee ${feeA}): ${priceA.toFixed(2)} USDC\n` +
                `Pool B (Fee ${feeB}): ${priceB.toFixed(2)} USDC\n` +
                `Est. Net Profit: >$0 for a $${config.trade.tradeSizeUSD} trade\n` +
                `Arbitrum Block: ${block}`;
    await notify(msg);

  } catch (e) {
    console.error('Scan error:', e);
    if (e.code === 'NETWORK_ERROR' || e.code === 'ECONNREFUSED' || e.code === 'noNetwork') {
      await notify(`Critical: All RPCs are down. Error: ${e.message}`);
    } else if (e.code === 'CALL_EXCEPTION') {
      await notify(`Critical: Contract call failed. Quoter V2 might be unreachable. Error: ${e.message}`);
    } else {
      console.error('Unhandled error during scan:', e);
    }
  }
}

/* ----------  START/STOP LOOP  ---------- */
let scanIntervalId;

const startArbLoop = () => {
  console.log('Starting Arbitrage Scanner...');
  console.log(`Configuration: Spread Threshold > ${config.thresholds.spreadPercent}%, Scan Interval: ${config.timing.scanIntervalMs / 1000}s`);
  scan(); // Run immediately on start
  scanIntervalId = setInterval(scan, config.timing.scanIntervalMs);
  return scanIntervalId;
};

const stopArbLoop = () => {
  if (scanIntervalId) {
    console.log('Stopping arbitrage scanner...');
    clearInterval(scanIntervalId);
    scanIntervalId = null;
    console.log('Arbitrage scanner stopped.');
  }
};

// Export both functions
module.exports = { startArbLoop, stopArbLoop };

// Start the bot if run directly
if (require.main === module) {
  startArbLoop();
}
