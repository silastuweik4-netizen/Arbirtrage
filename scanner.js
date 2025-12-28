// scanner.js  (v2 – single file, zero transpile, node ≥ 18)
import axios from 'axios';
import pino from 'pino';

/* ---------- ENV VALIDATION ---------- */
const env = {
  TELEGRAM_BOT_TOKEN:         process.env.TELEGRAM_BOT_TOKEN,
  CHAT_ID:                    process.env.CHAT_ID,
  DRY_RUN:                    process.env.DRY_RUN === 'true',
  ARBITRAGE_THRESHOLD_PERCENT: 0.5,
  MIN_LIQUIDITY_USD:          5_000,
  HIGH_CONFIDENCE_THRESHOLD:  1.0,
  MIN_LIQUIDITY_FOR_TRADE_USD: 20_000,
  MIN_VOLUME_USD:             10_000,
  POLL_MS:                    10 * 60 * 1000,
};
(() => { if (!env.TELEGRAM_BOT_TOKEN || !env.CHAT_ID) { console.error('❌  Set TELEGRAM_BOT_TOKEN and CHAT_ID'); process.exit(1); } })();

/* ---------- LOGGER ---------- */
const logger = pino({ level: 'info' }, pino.transport({ target: 'pino-pretty' }));

/* ---------- STATIC DATA ---------- */
const MINTS_TO_SEARCH = [
  { symbol: 'USDC', mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  { symbol: 'USDT', mintAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' },
];
const SYMBOLS_TO_SEARCH = [
  'SOL','BONK','WIF','JUP','RAY','RNDR','PEPE','POPCAT','FIDA',
  'SAMO','ORCA','MNGO','SRM','LDO','TNSR','PYTH',
];

/* ---------- UTILS ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cache = new Map(); // TTL = 2 min
const cacheHit = k => { const v = cache.get(k); return v && v.ts > Date.now() - 120_000 ? v.data : null; };
const cacheSet = (k, d) => cache.set(k, { data: d, ts: Date.now() });

let circuitOpen = false;
const axiosGet = async (url, retries = 3) => {
  if (circuitOpen) { logger.warn('Circuit open – skipping call'); throw new Error('Circuit open'); }
  for (let i = 0; i < retries; i++) {
    try {
      const { data } = await axios.get(url, { timeout: 8_000 });
      return data;
    } catch (e) {
      if (i === retries - 1) { circuitOpen = true; setTimeout(() => { circuitOpen = false; }, 120_000); throw e; }
      await sleep(2 ** i * 1_000);
    }
  }
};

/* ---------- PROFIT ---------- */
const calcNetProfit = (buyPrice, sellPrice, sizeUsd) => {
  const gross = (sellPrice - buyPrice) * (sizeUsd / buyPrice);
  const fee = sizeUsd * 0.0025 * 2; // 0.25 % each leg
  const net = gross - fee;
  return { netProfitUsd: net, netProfitPc: (net / sizeUsd) * 100 };
};

/* ---------- TELEGRAM ---------- */
const sendTelegram = async text => {
  if (env.DRY_RUN) { logger.info({ dryRun: true, text }, 'Would send Telegram'); return; }
  try {
    await axios.post(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: env.CHAT_ID,
      text,
      parse_mode: 'Markdown',
    });
    logger.info('Telegram alert sent');
  } catch (e) { logger.error({ err: e.message }, 'Telegram failed'); }
};

/* ---------- CORE SCAN ---------- */
const scanOnce = async () => {
  logger.info('Starting scan');
  const queries = [
    ...MINTS_TO_SEARCH.map(m => m.mintAddress),
    ...SYMBOLS_TO_SEARCH,
  ];

  // Parallel fetch with cache
  const allPairs = [];
  await Promise.all(queries.map(async q => {
    try {
      const cached = cacheHit(q);
      if (cached) { allPairs.push(...cached); return; }
      const res = await axiosGet(`https://api.dexscreener.com/latest/dex/search?q=${q}`);
      const valid = (res.pairs || []).filter(p =>
        p.chainId === 'solana' &&
        (p.quoteToken.symbol === 'USDC' || p.quoteToken.symbol === 'USDT') &&
        (p.liquidity?.usd ?? 0) > env.MIN_LIQUIDITY_USD
      );
      cacheSet(q, valid);
      allPairs.push(...valid);
    } catch (e) { logger.error({ query: q, err: e.message }, 'Search failed'); }
  }));

  // Group by base token
  const groups = new Map();
  for (const p of allPairs) {
    const addr = p.baseToken.address;
    if (!groups.has(addr)) groups.set(addr, []);
    groups.get(addr).push(p);
  }

  // Arb pass
  for (const [_, pairs] of groups) {
    if (pairs.length < 2) continue;
    let minPrice = Infinity, maxPrice = 0, buyPair = null, sellPair = null;
    for (const p of pairs) {
      const px = parseFloat(p.priceUsd);
      if (px < minPrice) { minPrice = px; buyPair = p; }
      if (px > maxPrice) { maxPrice = px; sellPair = p; }
    }
    if (!buyPair || !sellPair || buyPair.dexId === sellPair.dexId) continue;
    const spreadPc = ((maxPrice - minPrice) / minPrice) * 100;
    if (spreadPc < env.ARBITRAGE_THRESHOLD_PERCENT) continue;

    const buyLiq  = buyPair.liquidity?.usd  ?? 0;
    const sellLiq = sellPair.liquidity?.usd ?? 0;
    const sellVol = sellPair.volume?.h24    ?? 0;
    const liqOk   = buyLiq > env.MIN_LIQUIDITY_FOR_TRADE_USD && sellLiq > env.MIN_LIQUIDITY_FOR_TRADE_USD;
    const volOk   = sellVol > env.MIN_VOLUME_USD;
    const highConf= spreadPc > env.HIGH_CONFIDENCE_THRESHOLD;
    const { netProfitPc } = calcNetProfit(minPrice, maxPrice, 10_000);

    const symbol = pairs[0].baseToken.symbol;
    logger.info({ symbol, spreadPc: spreadPc.toFixed(2), netProfitPc: netProfitPc.toFixed(2), liqOk, volOk, highConf }, 'Opportunity');

    if (highConf && liqOk && volOk) {
      const msg =
        `🔥 **HIGH-CONFIDENCE Opportunity!**\\n\\n` +
        `Token: *${symbol}*\\n` +
        `Gross spread: *${spreadPc.toFixed(2)}%*\\n` +
        `Est. net profit: *${netProfitPc.toFixed(2)}%*\\n` +
        `Buy: *${buyPair.dexId}*  –  Sell: *${sellPair.dexId}*`;
      await sendTelegram(msg);
    }
  }
  logger.info('Scan finished');
};

/* ---------- LIFECYCLE ---------- */
let running = true;
const id = setInterval(() => running && scanOnce().catch(logger.error), env.POLL_MS);
scanOnce().catch(logger.error);

process.on('SIGTERM', () => { logger.info('SIGTERM – finishing current loop'); running = false; });
process.on('SIGINT', () => { logger.info('SIGINT – graceful exit'); running = false; setTimeout(() => process.exit(0), 3_000); });

/* ---------- ENV QUICK REFERENCE ----------
TELEGRAM_BOT_TOKEN=xxxxxxxxxx
CHAT_ID=yyyyyyyyyy
DRY_RUN=false
*/
