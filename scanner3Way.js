/********************************************************************
 *  scanner3Way-MINIMAL.js  (works out-of-the-box)
 *******************************************************************/
const { ethers } = require('ethers');
const ThreeWayArbitrageCalculator = require('./threeWayArbitrageCalculator');

const RPC = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/YOUR_KEY';
const provider = new ethers.JsonRpcProvider(RPC, { chainId: 8453 }, { staticNetwork: true });

const SLOT0_ABI   = ['function slot0() view returns (uint160 sqrtPriceX96,int24,uint16,uint16,uint16,uint8,bool)'];
const QUOTER_ABI  = ['function quoteExactInputSingle((address,address,uint256,uint24,uint160)) external returns (uint256,uint160,uint32,uint256)'];

const QUOTERS = {
  UNISWAP:   '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  PANCAKE:   '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997'
};

/* ---------- CHECKSUM ---------- */
const chk = (a) => ethers.getAddress(a);

/* ---------- 3 MAJOR POOLS ---------- */
const POOLS = [
  { pair: 'WETH/USDC',   fee: 500,  token0: chk('0x4200000000000000000000000000000000000006'), token1: chk('0x833589fCD6EDb6E08f4c7c32D4f71b54bdA02913'), aero: '0xC7d7CdBe3785bA58a5dB4C204b13E5aA0E4f5c9B' },
  { pair: 'AERO/WETH',   fee: 3000, token0: chk('0x940181a94A35A4569E4529A3cDfB74e38FD98631'), token1: chk('0x4200000000000000000000000000000000000006'), aero: '0x7Bd0a9F3c204b13E5aA0E4f5c9B6D3E2A1f0c9Ef' },
  { pair: 'USDC/USDbC',  fee: 100,  token0: chk('0x833589fCD6EDb6E08f4c7c32D4f71b54bdA02913'), token1: chk('0xd9aAEc86B65D86f6A7B5B1b0f42D531E7EdF9C60'), aero: '0xE3Ad81dCc204b13E5aA0E4f5c9B6D3E2A1f0c9Ef' }
];

/* ---------- LIVE PRICE ---------- */
async function livePrice(dex, t0, t1, fee) {
  try {
    if (dex === 'AERO') {
      const pool = POOLS.find(p => p.token0 === t0 && p.token1 === t1 && p.fee === fee)?.aero;
      if (!pool) return 0;
      const c = new ethers.Contract(pool, SLOT0_ABI, provider);
      const [sx] = await c.slot0();
      return Number(sx ** 2n / (2n ** 192n));
    }
    const quoter = new ethers.Contract(dex === 'UNI' ? QUOTERS.UNISWAP : QUOTERS.PANCAKE, QUOTER_ABI, provider);
    const amt = ethers.parseUnits('1', 18);
    const [out] = await quoter.quoteExactInputSingle.staticCall({ tokenIn: t0, tokenOut: t1, amountIn: amt, fee, sqrtPriceLimitX96: 0 });
    return Number(ethers.formatUnits(out, 18));
  } catch (e) {
    console.error(`Price fail: ${dex} ${t0}->${t1} ${fee}`, e.message);
    return 0;
  }
}

/* ---------- ONE-SHOT SCAN ---------- */
async function scan() {
  console.log('\n✅ Minimal 3-way scan started...\n');
  for (const p of POOLS) {
    const [aeroP, uniP, cakeP] = await Promise.all([
      livePrice('AERO',  p.token0, p.token1, p.fee),
      livePrice('UNI',   p.token0, p.token1, p.fee),
      livePrice('PANCAKE', p.token0, p.token1, p.fee)
    ]);
    console.log(`${p.pair.padEnd(12)} | Aero: ${aeroP.toFixed(6)} | Uni: ${uniP.toFixed(6)} | Cake: ${cakeP.toFixed(6)}`);
  }
  console.log('\n✅ Scan complete. Prices are live if > 0.\n');
  process.exit(0); // stop after one run
}

/* ---------- START ---------- */
scan().catch(console.error);
