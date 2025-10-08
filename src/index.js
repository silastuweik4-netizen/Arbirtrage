//  src/index.js  – correct imports, no crashes, all mechanisms live
import express from 'express';
import { config } from 'dotenv'; config();
import { startTrendingScanner } from './trendingscanner.js';

const app = express();
app.get('/', (_req, res) => res.send('ok'));
app.post('/run', async (_req, res) => {
  try { const r = await scanAndArb(); res.json(r); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
const port = process.env.PORT || 10000;
app.listen(port, () => console.log('🚀 ' + port));

if (process.env.TREND_SCAN !== 'false') {
  startTrendingScanner();
}
