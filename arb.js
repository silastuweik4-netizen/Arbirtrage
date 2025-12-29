/*  arb.js  –  WBTC/USDC spread watcher with retry and profitability check  */
require('dotenv').config();
const ethers = require('ethers');
const { notify } = require('./bot');
const config = require('./config.json');

/* ----------  CONFIGURATION & SETUP  ---------- */

// Arbitrum One Chain ID
const ARBITRUM_CHAIN_ID = 42161;

// Normalize pool addresses to lowercase immediately upon loading config
const POOL_A = { ...config.pools.poolA, addr: config.pools.poolA.addr.toLowerCase() };
const POOL_B = { ...config.pools.poolB, addr: config.pools.poolB.addr.toLowerCase() };

const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)'
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

/* ----------  PRICE CALL WITH RETRY  ---------- */
async function getPrice(poolMeta, retries = 2) {
  try {
    const provider = getProvider();
    // Address is already lowercase, bypassing the checksum error entirely
    const contract = new ethers.Contract(poolMeta.addr, POOL_ABI, provider);
    const { sqrtPriceX96 } = await contract.slot0();

    const Q192 = ethers.BigNumber.from(2).pow(192);
    const priceRaw = sqrtPriceX96.pow(2);
    
    // WBTC (8) to USDC (6) adjustment is 10^-2
    const priceAdjusted = priceRaw.mul(ethers.BigNumber.from(10).pow(6)).div(Q192).div(ethers.BigNumber.from(10).pow(8));

    return parseFloat(ethers.utils.formatUnits(priceAdjusted, 6));
  } catch (e) {
    if (retries > 0) {
      console.warn(`RPC fail: ${e.message.substring(0, 50)}...`);
      cycleRpc(); // Switch to the next RPC
      await new Promise(resolve => setTimeout(resolve, 1000)); // Short delay
      return getPrice(poolMeta, retries - 1);
    }
    console.error(`Failed to get price for ${poolMeta.name} after all retries.`);
    throw e;
  }
}

/* ----------  PROFITABILITY ESTIMATION  ---------- */
async function isProfitable(priceA, priceB) { // Provider is now derived internally if needed
  try {
    const provider = getProvider(); // Use the currently active provider for gas check
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
    // If we can't estimate, assume it's NOT profitable to be safe
    return false;
  }
}

/* ----------  HELPERS  ---------- */
function pct(a, b) { return Math.abs(a / b - 1) * 100; }

/* ----------  SCAN  ---------- */
async function scan() {
  try {
    console.log(`[${new Date().toISOString()}] Scanning for spread opportunities...`);
    // getPrice handles all RPC retries internally now
    const [priceA, priceB] = await Promise.all([getPrice(POOL_A), getPrice(POOL_B)]);
    const spread = pct(priceA, priceB);

    if (spread < config.thresholds.spreadPercent) {
      console.log(`Spread is ${spread.toFixed(4)}%, below threshold of ${config.thresholds.spreadPercent}%.`);
      return;
    }

    console.log(`🚨 Potential spread detected: ${spread.toFixed(2)}%`);

    // Pass prices to isProfitable
    const profitable = await isProfitable(priceA, priceB);

    if (!profitable) {
      console.log(`Spread of ${spread.toFixed(2)}% is not profitable after estimated costs.`);
      return;
    }
    
    const provider = getProvider();
    const block = await provider.getBlockNumber();
    const msg = `💰 Profitable WBTC/USDC spread: ${spread.toFixed(2)}%\n` +
                `Pool A: ${priceA.toFixed(2)} USDC (${POOL_A.name})\n` +
                `Pool B: ${priceB.toFixed(2)} USDC (${POOL_B.name})\n` +
                `Est. Net Profit: >$0 for a $${config.trade.tradeSizeUSD} trade\n` +
                `Arbitrum Block: ${block}`;
    await notify(msg);

  } catch (e) {
    // This catch block handles errors that persist after ALL retries fail
    console.error('Scan error:', e);
    if (e.code === 'NETWORK_ERROR' || e.code === 'ECONNREFUSED' || e.code === 'noNetwork') {
      await notify(`Critical: All RPCs are down. Error: ${e.message}`);
    } else if (e.code === 'CALL_EXCEPTION') {
      await notify(`Critical: Contract call failed. Check pool addresses. Error: ${e.message}`);
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
    console.log('Arbitrage scanner stopped.');
  }
};

// Export both functions
module.exports = { startArbLoop, stopArbLoop };
