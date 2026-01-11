// index.js
const ArbitrageBot = require('./bot');
const express = require('express');

console.log('🚀 Starting Base Network MEV Arbitrage Bot...');
console.log('===========================================');

// Health check server (Render requires a web server)
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'base-arbitrage-bot'
  });
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Base MEV Arbitrage Bot</title></head>
      <body>
        <h1>Base MEV Arbitrage Bot</h1>
        <p>Bot is running. Monitor logs for arbitrage opportunities.</p>
        <p><a href="/health">Health Check</a></p>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`✅ Health check server listening on port ${PORT}`);
});

// Start the bot with error handling
async function startBot() {
  try {
    const bot = new ArbitrageBot();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Received SIGINT, shutting down bot...');
      bot.isRunning = false;
      setTimeout(() => process.exit(0), 1000);
    });

    process.on('SIGTERM', () => {
      console.log('\n🛑 Received SIGTERM, shutting down...');
      bot.isRunning = false;
      setTimeout(() => process.exit(0), 1000);
    });

    await bot.start();
  } catch (error) {
    console.error('❌ Fatal error starting bot:', error);
    process.exit(1);
  }
}

startBot();
