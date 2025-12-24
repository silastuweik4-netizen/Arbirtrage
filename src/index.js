//  src/index.js  — cleaned (no HTML scraper, 15-s Jupiter + 2-s fee-arb factory)
import express from 'express';
import { config } from 'dotenv'; config();
import { scanAndArb } from './arbEngine.js';
import { runFeeArb } from './feeArb.js';   // 2-s micro-edge factory

const app = express();
app.get('/', (_req, res) => res.send('ok'));
app.post('/run', async (_req, res) => {
  try { const r = await scanAndArb(); res.json(r); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
const port = process.env.PORT || 10000;
app.listen(port, () => console.log('🚀 ' + port));

/* ---------- original 15-s Jupiter loop ---------- */
setInterval(async () => {
  await scanAndArb();
}, 15_000);

/* ---------- fee-arb factory every 2 seconds ---------- */
setInterval(async () => {
  await runFeeArb();
}, 2_000);
