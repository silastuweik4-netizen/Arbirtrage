//  src/index.js  – exact wiring for trendingscanner
import express from 'express';
import { config } from 'dotenv'; config();
import { scanAndArb } from './arbEngine.js';
import { startTrendingScanner } from './trendingscanner.js';   // ✅ exact file

const app = express();
app.get('/', (_req, res) => res.send('ok'));
app.post('/run', async (_req, res) => {
  try { const r = await scanAndArb(); res.json(r); }
  catch (e) { res.status(503).json({ error: e.message); }
});
const port = process.env.PORT || 10000;
app.listen(port, () => console.log('🚀 ' + port));

// start side-car trendingscanner (non-blocking)
if (process.env.TREND_SCAN !== 'false') {
  startTrendingScanner();                                    // ✅ exact launcher
}
