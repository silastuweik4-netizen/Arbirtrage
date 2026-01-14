// Render entry-point – optionally deploys contract on boot, then starts bot + health server
const http = require('http');
const { ethers } = require('ethers');
const config = require('./config');
const ArbitrageBot = require('./bot');

const PORT = process.env.PORT || 10000;

// 1. dummy health endpoint (Render requires an open port)
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }
  res.writeHead(404);
  res.end('Not Found');
});
server.listen(PORT, () => console.log(`✅ Health-check listening on :${PORT}`));

// 2. optional: deploy contract on every Render boot
(async () => {
  if (process.env.DEPLOY_ON_BOOT === 'true') {
    try {
      console.log('🚀 Deploying ArbitrageFlashloan...');
      const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL, 8453);
      const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
      const ArbitrageFlashloan = await ethers.getContractFactory('ArbitrageFlashloan', wallet);
      const arb = await ArbitrageFlashloan.deploy();
      await arb.waitForDeployment();
      const newAddress = await arb.getAddress();
      console.log('✅ Contract deployed to:', newAddress);
      // update config object in memory (does NOT persist file)
      config.contracts.arbitrageContract = newAddress.toLowerCase();
    } catch (err) {
      console.error('❌ Deploy failed:', err.message);
      process.exit(1);
    }
  }

  // 3. start the arbitrage loop
  const bot = new ArbitrageBot();
  bot.start().catch(err => {
    console.error('Bot crashed:', err);
    process.exit(1);
  });
})();

// 4. graceful shutdown on Render SIGTERM
process.on('SIGTERM', () => {
  console.log('Render SIGTERM – shutting down gracefully');
  server.close(() => process.exit(0));
});
