//  src/index.js  – entry point (flash-loan + trending-scraper)
import express from 'express';
import { config } from 'dotenv'; config();
import { scanAndArb } from './arbEngine.js';
import { startTrendingScanner } from './trendingscraper.js';   // ✅ new scraper

const app = express();
app.get('/', (_req, res) => res.send('ok'));
app.post('/run', async (_req, res) => {
  try { const r = await scanAndArb(); res.json(r); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
const port = process.env.PORT || 10000;
app.listen(port, () => console.log('🚀 ' + port));

// start side-car trending scraper (non-blocking)
if (process.env.TREND_SCAN !== 'false') {
  startTrendingScanner();                                    // ✅ new launcher
}
