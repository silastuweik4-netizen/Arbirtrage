/*  arb.js  –  Arbitrum WBTC/USDC spread watcher  */
require('dotenv').config();
const ethers = require('ethers');
const { Token } = require('@uniswap/sdk-core');
const { Pool } = require('@uniswap/v3-sdk');
const { notify } = require('./bot');

/* ----------  TOKENS  ---------- */
const WBTC = new Token(42161, '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC4B0F', 8, 'WBTC');
const USDC = new Token(42161, '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', 6, 'USDC');

/* ----------  POOLS  ---------- */
const POOL_A = {
  addr: '0x28b9C7Ab9d5A52BB62825FfDf61D2c2b4444E42C', // 0.05 %
  fee: 500,
  name: 'WBTC/USDC-0.05%'
};
const POOL_B = {
  addr: '0x5c4A8C6EA475c7eC163A06aC74c8F6D5Ef6082E5', // 0.30 %
  fee: 3000,
  name: 'WBTC/USDC-0.3%'
};

/* ----------  RPC  ---------- */
const provider = new ethers.providers.JsonRpcProvider('https://rpc.ankr.com/arbitrum');

/* ----------  ABI  ---------- */
const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)'
];

/* ----------  HELPERS  ---------- */
async function getPoolImmutables(poolMeta) {
  const contract = new ethers.Contract(poolMeta.addr, POOL_ABI, provider);
  const [slot0, liquidity] = await Promise.all([contract.slot0(), contract.liquidity()]);
  return {
    sqrtPriceX96: slot0.sqrtPriceX96.toString(),
    liquidity: liquidity.toString(),
    tick: slot0.tick
  };
}

async function buildPool(poolMeta) {
  const imm = await getPoolImmutables(poolMeta);
  return new Pool(WBTC, USDC, poolMeta.fee, imm.sqrtPriceX96, imm.liquidity, imm.tick);
}

function pct(a, b) {
  return Math.abs(a / b - 1) * 100;
}

/* ----------  SCAN + NOTIFY  ---------- */
async function scan() {
  try {
    const [poolA, poolB] = await Promise.all([buildPool(POOL_A), buildPool(POOL_B)]);
    const priceA = parseFloat(poolA.token0Price.toFixed(6)); // WBTC per USDC
    const priceB = parseFloat(poolB.token0Price.toFixed(6));
    const spread = pct(priceA, priceB);

    if (spread < 0.3) return; // ignore tiny gaps

    const block = await provider.getBlockNumber();
    const msg =
      `🚨 WBTC/USDC spread ${spread.toFixed(2)}%\n` +
      `PoolA ${priceA}  (${POOL_A.name})\n` +
      `PoolB ${priceB}  (${POOL_B.name})\n` +
      `Block ${block}`;
    await notify(msg);
  } catch (err) {
    console.error('Scan error:', err.message);
  }
}

/* ----------  LOOP EXPORT  ---------- */
exports.startArbLoop = () => {
  scan(); // first run immediately
  setInterval(scan, 30_000); // repeat every 30 s
};
