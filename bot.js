const axios = require('axios');
const TG = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;

module.exports = {
  notify: async (text) => {
    await axios.post(TG, { chat_id: process.env.CHAT_ID, text, parse_mode:'Markdown' });
  }
};
