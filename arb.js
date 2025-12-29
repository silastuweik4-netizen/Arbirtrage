/*  arb.js  –  WBTC/USDC spread watcher with retry and profitability check  */
require('dotenv').config();
const ethers = require('ethers');
const { notify } = require('./bot');
const config = require('./config.json');

/* ----------  RPCs  ---------- */
let rpcIndex = 0;
function getProvider() {
  const rpcUrl = config.rpcList[rpcIndex];
  return new ethers.providers.JsonRpcProvider(rpcUrl, { name: 'arbitrum', chainId: 42161 });
}

/* ----------  POOLS (from config)  ---------- */
const POOL_A = config.pools.poolA;
const POOL_B = config.pools.poolB;

const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)'
];

/* ----------  PRICE CALL WITH RETRY  ---------- */
async function getPrice(poolMeta, retries = 2) {
  try {
    const provider = getProvider();
    const contract = new ethers.Contract(poolMeta.addr, POOL_ABI, provider);
    const { sqrtPriceX96 } = await contract.slot0();

    // More precise price calculation: (sqrtPriceX96^2 / 2^192) * (10^token1_decimals / 10^token0_decimals)
    // This gives the price of token0 (WBTC) in terms of token1 (USDC)
    const Q192 = ethers.BigNumber.from(2).pow(192);
    const priceRaw = sqrtPriceX96.pow(2);
    
    // WBTC has 8 decimals, USDC has 6. The adjustment is 10^(6-8) = 10^-2.
    // We multiply by 10^6 (USDC decimals) first, then divide by 10^8 (WBTC decimals).
    const priceAdjusted = priceRaw.mul(ethers.BigNumber.from(10).pow(6)).div(Q192).div(ethers.BigNumber.from(10).pow(8));

    return parseFloat(ethers.utils.formatUnits(priceAdjusted, 6)); // Format as USDC value
  } catch (e) {
    if (retries > 0) {
      console.warn(`RPC fail (${e.code}), switching RPC and retrying...`);
      rpcIndex = (rpcIndex + 1) % config.rpcList.length;
      await new Promise(resolve => setTimeout(resolve, 1000));
      return getPrice(poolMeta, retries - 1);
    }
    console.error(`Failed to get price for ${poolMeta.name} after all retries.`);
    throw e;
  }
}

/* ----------  PROFITABILITY ESTIMATION  ---------- */
async function isProfitable(priceA, priceB, provider) {
  try {
    const gasPrice = await provider.getGasPrice();
    const gasLimit = config.trade.estimatedGasLimit;
    const gasCostWei = gasPrice.mul(gasLimit);
    const gasCostEth = parseFloat(ethers.utils.formatEther(gasCostWei));
    const gasCostInUsdc = gasCostEth * config.trade.ethPriceInUsdc;

    const grossProfit = (Math.abs(priceA - priceB) / Math.max(priceA, priceB)) * config.trade.tradeSizeUSD;
    
    const slippageCost = (config.trade.estimatedSlippagePercent / 100) * config.trade.tradeSizeUSD;
    
    const totalCosts = gasCostInUsdc + slippageCost;
    const netProfit = grossProfit - totalCosts;

    console.log(`Profitability Check: Gross Profit: $${grossProfit.toFixed(2)}, Total Costs: $${totalCosts.toFixed(2)} (Gas: $${gasCostInUsdc.toFixed(2)}, Slippage: $${slippageCost.toFixed(2)}), Net Profit: $${netProfit.toFixed(2)}`);

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
    const [priceA, priceB] = await Promise.all([getPrice(POOL_A), getPrice(POOL_B)]);
    const spread = pct(priceA, priceB);

    if (spread < config.thresholds.spreadPercent) {
      console.log(`Spread is ${spread.toFixed(4)}%, below threshold of ${config.thresholds.spreadPercent}%.`);
      return;
    }

    console.log(`🚨 Potential spread detected: ${spread.toFixed(2)}%`);

    const provider = getProvider();
    const profitable = await isProfitable(priceA, priceB, provider);

    if (!profitable) {
      console.log(`Spread of ${spread.toFixed(2)}% is not profitable after estimated costs.`);
      return;
    }
    
    const block = await provider.getBlockNumber();
    const msg = `💰 Profitable WBTC/USDC spread: ${spread.toFixed(2)}%\n` +
                `Pool A: ${priceA.toFixed(2)} USDC (${POOL_A.name})\n` +
                `Pool B: ${priceB.toFixed(2)} USDC (${POOL_B.name})\n` +
                `Est. Net Profit: >$0 for a $${config.trade.tradeSizeUSD} trade\n` +
                `Arbitrum Block: ${block}`;
    await notify(msg);

  } catch (e) {
    console.error('Scan error:', e);
    // Send a notification for critical errors so you know the bot is failing
    if (e.code === 'NETWORK_ERROR' || e.code === 'ECONNREFUSED') {
      await notify(`Critical: Network error. All RPCs may be down. Error: ${e.message}`);
    } else if (e.code === 'CALL_EXCEPTION') {
      await notify(`Critical: Contract call failed. Check pool addresses. Error: ${e.message}`);
    } else {
      // Avoid spamming notifications for other unknown errors
      console.error('Unhandled error during scan:', e);
    }
  }
}

/* ----------  START LOOP  ---------- */
exports.startArbLoop = () => {
  console.log('Starting Arbitrage Scanner...');
  console.log(`Configuration: Spread Threshold > ${config.thresholds.spreadPercent}%, Scan Interval: ${config.timing.scanIntervalMs / 1000}s`);
  scan(); // Run immediately on start
  setInterval(scan, config.timing.scanIntervalMs);
};
