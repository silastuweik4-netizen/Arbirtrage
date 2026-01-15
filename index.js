// index.js
#!/usr/bin/env node
/*
 * Aerodrome USDC/USDbC spread – live on Base
 * Deployed as a Web Service on Render
 */
require('dotenv').config();

const { ethers } = require('ethers');
const express = require('express'); // <-- ADD THIS

// --- WEB SERVER SETUP ---
const app = express();
const port = process.env.PORT || 3000;

// A simple route to satisfy Render's health checks
app.get('/', (req, res) => {
  res.status(200).send('OK');
});

// Start the web server
app.listen(port, () => {
  console.log(`Web server listening on port ${port}`);
  // Start the monitoring logic only after the server is ready
  startMonitoring();
});

// --- ORIGINAL MONITORING LOGIC ---
async function startMonitoring() {
  console.log('Aerodrome USDC/USDbC spread – live every 2 s\n');

  const provider = new ethers.JsonRpcProvider(
    process.env.ALCHEMY_API_URL,
    8453,
    { staticNetwork: true }
  );

  const ROUTER = ethers.getAddress('0xcF77a3Ba9A5CA399B7c97c74d6e6b1aba2327f27');
  const USDC  = ethers.getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  const USDbC = ethers.getAddress('0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA');

  const amountIn = ethers.parseUnits('1000', 6);
  const router = new ethers.Contract(ROUTER, [
    'function getAmountsOut(uint256, tuple(address from, address to, bool stable)[]) view returns (uint256[])'
  ], provider);

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
}
