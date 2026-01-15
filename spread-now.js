#!/usr/bin/env node
/*
 * Aerodrome USDC/USDbC spread – live on Base
 * Addresses checksummed once, here only
 */
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider(
  'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
  8453,
  { staticNetwork: true }
);

// checksummed once – never again
const ROUTER = ethers.getAddress('0xcF77a3Ba9A5CA399B7c97c74d6e6b1aba2327f27');
const USDC  = ethers.getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
const USDbC = ethers.getAddress('0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA');

const amountIn = ethers.parseUnits('1000', 6);
const router = new ethers.Contract(ROUTER, [
  'function getAmountsOut(uint256, tuple(address from, address to, bool stable)[]) view returns (uint256[])'
], provider);

(async () => {
  console.log('Aerodrome USDC/USDbC spread – live every 2 s\n');
  setInterval(async () => {
    try {
      const [vol, stab] = await Promise.all([
        router.getAmountsOut(amountIn, [[USDC, USDbC, false]]),
        router.getAmountsOut(amountIn, [[USDC, USDbC, true ]])
      ]);
      const spread = Number(stab[1] - vol[1]) * 10_000 / Number(amountIn);
      console.log(`Volatile: ${ethers.formatUnits(vol[1],6)} USDbC | Stable: ${ethers.formatUnits(stab[1],6)} USDbC | Spread: ${spread.toFixed(2)} bps`);
      if (spread > 5) console.log('>>> OPPORTUNITY:', spread.toFixed(2), 'bps');
    } catch (e) {
      console.log('Call failed:', e.shortMessage || e.message);
    }
  }, 2000);
})();
