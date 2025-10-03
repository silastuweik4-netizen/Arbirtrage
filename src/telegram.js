//  telegram.js
import TelegramBot from 'node-telegram-bot-api';
import { config } from 'dotenv'; config();

const bot   = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const chatId= process.env.TELEGRAM_CHAT_ID;

export async function notify(htmlMsg) {
  if (!chatId) return;
  try { await bot.sendMessage(chatId, htmlMsg, { parse_mode: 'HTML' }); }
  catch (e) { console.log('TG err:', e.message); }
}
