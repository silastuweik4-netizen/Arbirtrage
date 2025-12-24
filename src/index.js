//  src/index.js  — Jupiter 15 s + fee-arb factory 2 s + optional HTML scraper
import express from 'express';
import { config } from 'dotenv'; config();
import { startTrendingScanner } from './trendingscanner.js';
import { scanAndArb } from './arbEngine.js';
import { runFeeArb } from './feeArb.js';   // NEW

const app = express();
app.get('/', (_req, res) => res.send('ok'));
app.post('/run', async (_req, res) => {
  try { const r = await scanAndArb(); res.json(r); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
const port = process.env.PORT || 10000;
app.listen(port, () => console.log('🚀 ' + port));

/* ---------- original 15 s Jupiter loop ---------- */
setInterval(async () => {
  await scanAndArb();
}, 15_000);

/* ---------- fee-arb factory every 2 seconds ---------- */
setInterval(async () => {
  await runFeeArb();
}, 2_000);

/* ---------- optional HTML scraper ---------- */
if (process.env.TREND_SCAN !== 'false') {
  startTrendingScanner();
}
