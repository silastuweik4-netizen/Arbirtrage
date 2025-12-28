// scanner.js  (v4 – self-populates 300 top Solflare tokens, no manual adds)
import axios from 'axios';

/* ---------- ENV ---------- */
const env = {
  TELEGRAM_BOT_TOKEN:         process.env.TELEGRAM_BOT_TOKEN,
  CHAT_ID:                    process.env.CHAT_ID,
  DRY_RUN:                    process.env.DRY_RUN === 'true',
  ARBITRAGE_THRESHOLD_PERCENT: 0.5,
  MIN_LIQUIDITY_USD:          5_000,
  MIN_LIQUIDITY_FOR_TRADE_USD: 20_000,
  HIGH_CONFIDENCE_THRESHOLD:  0.5,
  POLL_MS:                    10 * 60 * 1000,
  TOKEN_REFRESH_MS:           6 * 60 * 60 * 1000, // 6 h
};
(() => { if (!env.TELEGRAM_BOT_TOKEN || !env.CHAT_ID) { console.error('❌  Set TELEGRAM_BOT_TOKEN and CHAT_ID'); process.exit(1); } })();

/* ---------- STABLES WE QUOTE AGAINST ---------- */
const STABLES = [
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
];

/* ---------- UTILS ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cache = new Map(); // 2-min cache for DS calls
const cacheHit = k => { const v = cache.get(k); return v && v.ts > Date.now() - 120_000 ? v.data : null; };
const cacheSet = (k, d) => cache.set(k, { data: d, ts: Date.now() });

let circuitOpen = false;
const axiosGet = async (url, retries = 3) => {
  if (circuitOpen) throw new Error('Circuit open');
  for (let i = 0; i < retries; i++) {
    try { return (await axios.get(url, { timeout: 8_000 })).data; }
    catch (e) {
      if (i === retries - 1) { circuitOpen = true; setTimeout(() => circuitOpen = false, 120_000); throw e; }
      await sleep(2 ** i * 1_000);
    }
  }
};

/* ---------- PROFIT ---------- */
const calcNetProfit = (buyPrice, sellPrice, sizeUsd) => {
  const gross = (sellPrice - buyPrice) * (sizeUsd / buyPrice);
  const fee = sizeUsd * 0.0025 * 2;
  const net = gross - fee;
  return { netProfitUsd: net, netProfitPc: (net / sizeUsd) * 100 };
};

/* ---------- TELEGRAM ---------- */
const sendTelegram = async text => {
  if (env.DRY_RUN) { console.log(`[DRY-RUN] Would send:\n${text}`); return; }
  try {
    await axios.post(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: env.CHAT_ID,
      text,
      parse_mode: 'Markdown',
    });
    console.log('✅ Telegram alert sent');
  } catch (e) { console.error('Telegram failed:', e.message); }
};

/* ---------- AUTO TOKEN LIST ---------- */
let TOKEN_CONTRACTS = ['So11111111111111111111111111111111111111112']; // seed SOL

const updateTokenList = async () => {
  try {
    console.log('Downloading Solflare token-list...');
    const list = await axiosGet('https://raw.githubusercontent.com/solflare-wallet/token-list/master/solana-tokenlist.json');
    const cleaned = list.tokens
      .filter(t => t.chainId === 101)                              // main-net
      .filter(t => t.decimals != null && t.symbol && t.name)       // sane metadata
      .filter(t => !t.tags || !t.tags.some(tag => ['stablecoin','lp-token','wormhole'].includes(tag.toLowerCase())))
      .sort((a,b) => (b.supply || 0) - (a.supply || 0))            // biggest first
      .slice(0, 300)
      .map(t => t.address);
    TOKEN_CONTRACTS = ['So11111111111111111111111111111111111111112', ...cleaned];
    console.log(`Loaded ${TOKEN_CONTRACTS.length} tokens`);
  } catch (e) { console.error('Token-list update failed', e.message); }
};

/* ---------- BUILD SEARCH LIST ---------- */
const getSearches = () => [
  ...TOKEN_CONTRACTS,
  'So11111111111111111111111111111111111111112', // SOL itself
];

/* ---------- CORE SCAN ---------- */
const scanOnce = async () => {
  console.log(`[${new Date().toISOString()}] Starting scan (dry-run: ${env.DRY_RUN})`);
  const allPairs = [];
  await Promise.all(getSearches().map(async q => {
    try {
      const cached = cacheHit(q);
      if (cached) { allPairs.push(...cached); return; }
      const res = await axiosGet(`https://api.dexscreener.com/latest/dex/search?q=${q}`);
      const valid = (res.pairs || []).filter(p => {
        if (p.chainId !== 'solana') return false;
        const quote = p.quoteToken.address;
        return quote === 'So11111111111111111111111111111111111111112' || STABLES.includes(quote);
      }).filter(p => (p.liquidity?.usd ?? 0) > env.MIN_LIQUIDITY_USD);
      cacheSet(q, valid);
      allPairs.push(...valid);
    } catch (e) { console.error('Search error for', q, e.message); }
  }));

  const groups = new Map();
  for (const p of allPairs) {
    const addr = p.baseToken.address;
    if (!groups.has(addr)) groups.set(addr, []);
    groups.get(addr).push(p);
  }

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
    const liqOk   = buyLiq > env.MIN_LIQUIDITY_FOR_TRADE_USD && sellLiq > env.MIN_LIQUIDITY_FOR_TRADE_USD;
    const highConf= spreadPc > env.HIGH_CONFIDENCE_THRESHOLD;
    const { netProfitPc } = calcNetProfit(minPrice, maxPrice, 10_000);

    const symbol = pairs[0].baseToken.symbol || buyPair.baseToken.address.slice(0, 6) + '…';
    console.log(`🚨 ${symbol}  spread ${spreadPc.toFixed(2)}%  net ${netProfitPc.toFixed(2)}%  liqOK ${liqOk}`);

    if (highConf && liqOk) {
      const msg =
        `🔥 **HIGH-CONFIDENCE Opportunity!**\\n\\n` +
        `Token: *${symbol}*\\n` +
        `Gross spread: *${spreadPc.toFixed(2)}%*\\n` +
        `Est. net profit: *${netProfitPc.toFixed(2)}%*\\n` +
        `Buy: *${buyPair.dexId}*  –  Sell: *${sellPair.dexId}*`;
      await sendTelegram(msg);
    }
  }
  console.log('Scan finished');
};

/* ---------- LIFECYCLE ---------- */
let running = true;
setInterval(() => running && scanOnce().catch(console.error), env.POLL_MS);
setInterval(updateTokenList, env.TOKEN_REFRESH_MS); // refresh every 6 h
updateTokenList().then(() => scanOnce().catch(console.error));
process.on('SIGTERM', () => { running = false; console.log('SIGTERM – graceful exit'); });
process.on('SIGINT',  () => { running = false; console.log('SIGINT – graceful exit'); setTimeout(() => process.exit(0), 3_000); });

/* ---------- ENV ----------
TELEGRAM_BOT_TOKEN=xxx
CHAT_ID=yyy
DRY_RUN=false
*/
