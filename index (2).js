#!/usr/bin/env node

require('dotenv').config();
const http = require('http');
const ArbitrageBot = require('./bot');

// 1. Create a tiny web server to keep Render Free Tier alive
// This prevents the "Port scan timeout" error
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Base Arbitrage Bot is active and scanning...\n');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`✅ Health check server listening on port ${PORT}`);
});

// 2. Create bot instance
const bot = new ArbitrageBot();

// Handle graceful shutdown
const shutdown = () => {
  console.log('\n\nReceived shutdown signal...');
  // Check if bot has a stop method (some versions might not)
  if (typeof bot.stop === 'function') {
    bot.stop();
  }
  setTimeout(() => {
    console.log('Bot stopped. Goodbye! 👋\n');
    process.exit(0);
  }, 1000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 3. Start the bot
console.log('Starting Base Network Arbitrage Bot...\n');
bot.start().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
