import fetch from 'node-fetch';
const TELEGRAM_ID = process.env.TELEGRAM_ID;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

export async function notify(message) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_ID, text: message, parse_mode: 'HTML' })
    });
  } catch (e) {
    console.log('Telegram error', e.message);
  }
}
