/*  arb.js  –  pure-ethers WBTC/USDC spread watcher  */
require('dotenv').config();
const ethers = require('ethers');
const { notify } = require('./bot');

/* ----------  RPC (stable free endpoint)  ---------- */
const provider = new ethers.providers.JsonRpcProvider(
  'https://arbitrum-one.public.blastapi.io',
  { name: 'arbitrum', chainId: 42161 }
);

/* ----------  POOLS (lowercase)  ---------- */
const POOL_A = { addr: '0x28b9c7ab9d5a52bb62825ffdf61d2c2b4444e42c', fee: 500,  name: 'WBTC/USDC-0.05%' };
const POOL_B = { addr: '0x5c4a8c6ea475c7ec163a06ac74c8f6d5ef6082e5', fee: 3000, name: 'WBTC/USDC-0.3%'  };

const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)'
];

async function getPrice(poolMeta) {
  const c = new ethers.Contract(poolMeta.addr, POOL_ABI, provider);
  const { sqrtPriceX96 } = await c.slot0();
  const sqrt = sqrtPriceX96.mul(sqrtPriceX96);
  const shift = ethers.BigNumber.from(2).pow(192);
  const raw = sqrt.mul(1e8).div(shift); // 8 dec -> 6 dec
  return parseFloat(ethers.utils.formatUnits(raw, 6));
}

function pct(a, b) { return Math.abs(a / b - 1) * 100; }

async function scan() {
  try {
    const [priceA, priceB] = await Promise.all([getPrice(POOL_A), getPrice(POOL_B)]);
    const spread = pct(priceA, priceB);
    if (spread < 0.3) return;
    const block = await provider.getBlockNumber();
    const msg = `🚨 WBTC/USDC spread ${spread.toFixed(2)}%\nPoolA ${priceA.toFixed(2)}  (${POOL_A.name})\nPoolB ${priceB.toFixed(2)}  (${POOL_B.name})\nBlock ${block}`;
    await notify(msg);
  } catch (e) { console.error('Scan error:', e.message); }
}

exports.startArbLoop = () => { scan(); setInterval(scan, 30_000); };
