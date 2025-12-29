/*  bot.js  –  Robust Telegram Notifier  */
const axios = require('axios');

// Get Telegram configuration from environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

/**
 * Sends a notification message to a configured Telegram chat.
 * @param {string} text The message text to send.
 * @param {string} [parse_mode='Markdown'] The parsing mode for the message ('Markdown' or 'HTML').
 * @returns {Promise<boolean>} True if the message was sent successfully, false otherwise.
 */
module.exports = {
  notify: async (text, parse_mode = 'Markdown') => {
    // Ensure required environment variables are set at startup
    if (!TELEGRAM_TOKEN || !CHAT_ID) {
      console.error('Telegram bot error: TELEGRAM_TOKEN or CHAT_ID is not set in .env file.');
      return false;
    }

    try {
      const payload = {
        chat_id: CHAT_ID,
        text: text,
        parse_mode: parse_mode,
      };

      // Use axios to post the message to the Telegram API
      const response = await axios.post(TELEGRAM_API_URL, payload);

      // The Telegram API returns { ok: true } on success
      if (response.data.ok) {
        console.log('✅ Telegram notification sent successfully.');
        return true;
      } else {
        // Handle cases where the API returns a 200 OK but with an error message
        console.error('Telegram API error:', response.data.description);
        return false;
      }
    } catch (error) {
      // Handle network errors, 4xx/5xx HTTP status codes, etc.
      console.error('❌ Failed to send Telegram notification.');
      
      // Log more details if available from the axios error object
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.error(`Status: ${error.response.status}`);
        console.error('Data:', error.response.data);
      } else if (error.request) {
        // The request was made but no response was received
        console.error('No response received from Telegram API.');
      } else {
        // Something happened in setting up the request that triggered an Error
        console.error('Error:', error.message);
      }
      
      return false;
    }
  }
};
