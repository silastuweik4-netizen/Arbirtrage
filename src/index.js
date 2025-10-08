//  src/index.js  – final, complete, keeps all three mechanisms side-by-side
import express from 'express';
import { config } from 'dotenv'; config();
import { scanAndArb } from './arbEngine.js';
import { startTrendingScanner } from './trendingscanner.js';   // auto-append every 60 s

const app = express();
app.get('/', (_req, res) => res.send('ok'));
app.post('/run', async (_req, res) => {
  try { const r = await scanAndArb(); res.json(r); }
  catch (e) { res.status(503).json({ error: e.message); }
});
const port = process.env.PORT || 10000;
app.listen(port, () => console.log('🚀 ' + port));

// auto-append every 60 s
if (process.env.TREND_SCAN !== 'false') {
  startTrendingScanner();                                    // auto-append every 60 s
  }
