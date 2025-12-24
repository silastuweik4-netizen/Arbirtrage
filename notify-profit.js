//  notify-profit.js  — send profit notifications
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
const CHAT_ID = process.env.CHAT_ID;

async function notifyProfit(opportunity) {
  if (!bot || !CHAT_ID) return;
  
  const message = `
🎯 PROFIT ALERT!
💰 Amount: $${opportunity.net.toFixed(4)}
📊 Spread: ${opportunity.spread.toFixed(1)} BPS
💵 Price: $${opportunity.price.toFixed(2)}
⏰ Time: ${new Date().toLocaleString()}
  `.trim();
  
  try {
    await bot.sendMessage(CHAT_ID, message);
    console.log('📱 Telegram notification sent');
  } catch (error) {
    console.log('Telegram notification failed:', error.message);
  }
}

module.exports = { notifyProfit };
