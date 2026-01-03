#!/usr/bin/env node

const ArbitrageBot = require('./bot');

// Create bot instance
const bot = new ArbitrageBot();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nReceived SIGINT signal...');
  bot.stop();
  setTimeout(() => {
    console.log('Bot stopped. Goodbye! 👋\n');
    process.exit(0);
  }, 1000);
});

process.on('SIGTERM', () => {
  console.log('\n\nReceived SIGTERM signal...');
  bot.stop();
  setTimeout(() => {
    console.log('Bot stopped. Goodbye! 👋\n');
    process.exit(0);
  }, 1000);
});

// Start the bot
console.log('Starting Base Network Arbitrage Bot...\n');
bot.start().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
