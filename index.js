// Render entry-point – no dotenv required (env vars come from Render dashboard)
const http = require('http');
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

// 2. start the arbitrage loop
const bot = new ArbitrageBot();
bot.start().catch(err => {
  console.error('Bot crashed:', err);
  process.exit(1);
});

// 3. graceful shutdown on Render SIGTERM
process.on('SIGTERM', () => {
  console.log('Render SIGTERM received – shutting down gracefully');
  bot.stop();
  server.close(() => process.exit(0));
});
