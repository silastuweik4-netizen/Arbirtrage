import express from 'express';
import { config } from 'dotenv'; config();
import { scanAndArb } from './arbEngine.js';
const app = express();
app.get('/', (_req, res) => res.send('ok'));
app.post('/run', async (_req, res) => {
  try { const r = await scanAndArb(); res.json(r); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
const port = process.env.PORT || 10000;
app.listen(port, () => console.log('🚀 ' + port));
import { startScanner } from './memescanner.js';

// start side-car scanner (non-blocking)
if (process.env.SCAN_MEME !== 'false') {
  startScanner().catch(e => console.log('Scanner crash:', e));
}
