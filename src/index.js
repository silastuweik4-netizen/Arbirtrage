//  src/index.js  – entry point (flash-loan + safety-gated scanner)
import express from 'express';
import { config } from 'dotenv'; config();
import { scanAndArb } from './arbEngine.js';
import { startMemeScanner } from './memescanner.js';   // ✅ safety-gated scanner

const app = express();
app.get('/', (_req, res) => res.send('ok'));
app.post('/run', async (_req, res) => {
  try { const r = await scanAndArb(); res.json(r); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
const port = process.env.PORT || 10000;
app.listen(port, () => console.log('🚀 ' + port));

// start safety-gated scanner (non-blocking)
if (process.env.MEME_SCAN !== 'false') {
  startMemeScanner();                                    // ✅ safety-gated launcher
}
