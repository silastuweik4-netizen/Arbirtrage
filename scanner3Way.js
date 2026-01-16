Here's the updated version of your JavaScript file with the necessary corrections and improvements:

```javascript
/********************************************************************
 *  scanner3Way-MINIMAL-CORRECTED.js  (checksum-safe, network-fixed)
 *******************************************************************/
const { ethers } = require('ethers');
const ThreeWayArbitrageCalculator = require('./threeWayArbitrageCalculator');

const RPC = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/YOUR_KEY';
const provider = new ethers.JsonRpcProvider(RPC, 8453, { staticNetwork: true }); // <-- FIXED

const SLOT0_ABI   = ['function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)'];
const QUOTER_ABI  = ['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)'];

const QUOTERS = {
  UNISWAP: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  PANCAKE: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997'
};

const chk = (address) => {
  try {
    return ethers.getAddress(address);
  } catch (error) {
    console.error(`Invalid address checksum: ${address}`);
    return null; // Handle invalid addresses gracefully
  }
};

/* ---------- 3 MAJOR POOLS (CHECKSUMMED) ---------- */
const POOLS = [
  { pair: 'WETH/USDC', fee: 500, token0: chk('0x4200000000000000000000000000000000000006'), token1: chk('0x833589fCD6EDb6E08f4c7c32D4f71b54bdA02913'), aero: '0xC7d7CdBe3785bA58a5dB4C204b13E5aA0E4f5c9B' },
  { pair: 'AERO/WETH', fee: 3000, token0: chk('0x940181a94A35A4569E4529A3cDfB74e38FD98631'), token1: chk('0x4200000000000000000000000000000000000006'), aero: '0x7Bd0a9F3c204b13E5aA0E4f5c9B6D3E2A1f0c9Ef' },
  { pair: 'USDC/USDbC', fee: 100, token0: chk('0x833589fCD6EDb6E08f4c7c32D4f71b54bdA02913'), token1: chk('0xd9aAEc86B65D86f6A7B5B1b0f42D531E7EdF9C60'), aero: '0xE3Ad81dCc204b13E5aA0E4f5c9B6D3E2A1f0c9Ef' }
];

/* ---------- LIVE PRICE ---------- */
async function livePrice(dex, t0, t1, fee) {
  try {
    if (dex === 'AERO') {
      const pool = POOLS.find(p => p.token0 === t0 && p.token1 === t1 && p.fee === fee)?.aero;
      if (!pool) return 0;
      const c = new ethers.Contract(pool, SLOT0_ABI, provider);
      const [sx] = await c.slot0();
      // Use BigNumber for accurate calculations
      const sqrtPrice = ethers.BigNumber.from(sx);
      return sqrtPrice.mul(sqrtPrice).div(ethers.BigNumber.from(2).pow(192)).toNumber();
    }
    
    const quoter = new ethers.Contract(dex === 'UNI' ? QUOTERS.UNISWAP : QUOTERS.PANCAKE, QUOTER_ABI, provider);
    const amt = ethers.parseUnits('1', 18);
    const [out] = await quoter.quoteExactInputSingle({ tokenIn: t0, tokenOut: t1, amountIn: amt, fee, sqrtPriceLimitX96: 0 });
    return Number(ethers.formatUnits(out, 18));
  } catch (e) {
    console.error(`Price fail: ${dex} ${t0}->${t1} ${fee}`, e);
    return 0;
  }
}

/* ----------
