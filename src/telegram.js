//  telegram.js
import TelegramBot from 'node-telegram-bot-api';
import { config } from 'dotenv'; config();

const BOT_TOKEN = process.env.BOT_TOKEN?.trim();   // trim kills accidental spaces
const CHAT_ID   = process.env.CHAT_ID?.trim();

if (!BOT_TOKEN || !CHAT_ID) {
  console.warn('⚠️  BOT_TOKEN or CHAT_ID missing – Telegram alerts disabled');
}

const bot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN, { polling: false }) : null;

export async function notify(html) {
  if (!bot) return;                       // silent fail if no creds
  try {
    await bot.sendMessage(CHAT_ID, html, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (e) {
    console.log('Telegram send failed:', e.message);
  }
}
