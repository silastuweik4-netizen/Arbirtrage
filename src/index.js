//  src/index.js  – all mechanisms live, no crashes
import express from 'express';
import { config } from 'dotenv'; config();
import { startTrendingScanner } from './trendingscanner.js';
import { startSeedScanner } from './seedScanner.js';   // ← NEW
import { scanAndArb } from './arbEngine.js';           // ← NEW (was missing)

const app = express();
app.get('/', (_req, res) => res.send('ok'));
app.post('/run', async (_req, res) => {
  try { const r = await scanAndArb(); res.json(r); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
const port = process.env.PORT || 10000;
app.listen(port, () => console.log('🚀 ' + port));

/* ---------- start scanners ---------- */
if (process.env.TREND_SCAN !== 'false') {
  startTrendingScanner();
}
startSeedScanner((seed) => {
  // inject seed mint into SCAN_MINTS for next 15 s cycle
  const mint = seed.tokenA;
  if (!process.env.SCAN_MINTS.includes(mint)) {
    process.env.SCAN_MINTS += ',' + mint;
    console.log('[INDEX]  seed injected →', mint);
  }
});
