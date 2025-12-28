// scanner.js  (v5 – no DexScreener, no npm packages, live on-chain)
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

/* ---------- CONSTANTS ---------- */
const RPC = 'https://api.mainnet-beta.solana.com';
const RAYDIUM_PROG = 'RVKd61ztZW9GUwhRbbLoYVRE5Xf1B2tVscKqwZqVKdNV'; // AMM v4
const STABLES = [
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
];

/* ---------- UTILS ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64ToBytes = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
const readU64 = (buf, off) => {
  const v = new DataView(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + 8));
  return v.getBigUint64(0, true);
};
const axiosPost = body => axios.post(RPC, body, { headers: { 'Content-Type': 'application/json' } });

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
    const list = await axios.get('https://cdn.jsdelivr.net/gh/solflare-wallet/token-list@latest/solana-tokenlist.json')
      .then(r => r.data);
    const cleaned = list.tokens
      .filter(t => t.chainId === 101)
      .filter(t => t.decimals != null && t.symbol && t.name)
      .filter(t => !t.tags || !t.tags.some(tag => ['stablecoin','lp-token','wormhole'].includes(tag.toLowerCase())))
      .sort((a, b) => (b.supply || 0) - (a.supply || 0))
      .slice(0, 300)
      .map(t => t.address);
    TOKEN_CONTRACTS = ['So11111111111111111111111111111111111111112', ...cleaned];
    console.log(`Loaded ${TOKEN_CONTRACTS.length} tokens`);
  } catch (e) { console.error('Token-list update failed', e.message); }
};

/* ---------- ON-CHAIN RAYDIUM POOLS ----------
   returns [ { dex:'Raydium', poolKey, baseVault, quoteVault }, … ] */
async function getRaydiumPools(mint) {
  const resp = await axiosPost({
    jsonrpc: '2.0',
    id: 1,
    method: 'getProgramAccounts',
    params: [
      RAYDIUM_PROG,
      {
        filters: [
          { dataSize: 388 },
          { memcmp: { offset: 32, bytes: mint } }
        ],
        encoding: 'base64'
      }
    ]
  });
  if (!resp.data.result) return [];
  return resp.data.result.map(({ account, pubkey }) => {
    const buf = b64ToBytes(account.data[0]);
    const baseVault  = buf.slice(80, 112).toString('hex');
    const quoteVault = buf.slice(112, 144).toString('hex');
    return { dex: 'Raydium', poolKey: pubkey, baseVault, quoteVault };
  });
}

/* ---------- RESERVES & PRICE ---------- */
async function reservesAndPrice(pool, mint) {
  const [base, quote] = (await axiosPost({
    jsonrpc: '2.0',
    id: 1,
    method: 'getMultipleAccounts',
    params: [
      [pool.baseVault, pool.quoteVault],
      { encoding: 'base64' }
    ]
  })).data.result.value;
  if (!base || !quote) return null;
  const baseAmt  = readU64(b64ToBytes(base.data[0]), 64);
  const quoteAmt = readU64(b64ToBytes(quote.data[0]), 64);
  if (baseAmt === 0n || quoteAmt === 0n) return null;
  const price = Number(quoteAmt) / Number(baseAmt);
  const liqUsd = Number(quoteAmt) / 1e6; // assume quote is USDC/USDT for now
  return { price, liquidityUsd: liqUsd };
}

/* ---------- THROTTLED POOL SCAN ---------- */
const CONCURRENCY = 5;
const asyncPool = async (poolLimit, array, iteratorFn) => {
  const ret = []; const executing = [];
  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);
    if (array.length >= poolLimit) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= poolLimit) await Promise.race(executing);
    }
  }
  return Promise.all(ret);
};

/* ---------- MAIN SCAN ---------- */
const scanOnce = async () => {
  console.log(`[${new Date().toISOString()}] Starting scan (dry-run: ${env.DRY_RUN})`);
  const allOpp = [];
  await asyncPool(CONCURRENCY, TOKEN_CONTRACTS, async mint => {
    const pools = await getRaydiumPools(mint);
    if (pools.length < 2) return;
    const priced = (await Promise.all(pools.map(async p => ({ ...p, ...(await reservesAndPrice(p, mint)) })))).filter(Boolean);
    if (priced.length < 2) return;
    const min = priced.reduce((a, b) => a.price < b.price ? a : b);
    const max = priced.reduce((a, b) => a.price > b.price ? a : b);
    const spreadPc = ((max.price - min.price) / min.price) * 100;
    const { netProfitPc } = calcNetProfit(min.price, max.price, 10_000);
    if (netProfitPc < env.HIGH_CONFIDENCE_THRESHOLD) return;
    const liqOk = Math.min(min.liquidityUsd, max.liquidityUsd) > env.MIN_LIQUIDITY_FOR_TRADE_USD;
    if (!liqOk) return;
    const symbol = mint.slice(0, 6) + '…';
    console.log(`🚨 ${symbol}  spread ${spreadPc.toFixed(2)}%  net ${netProfitPc.toFixed(2)}%  liqOK ${liqOk}`);
    allOpp.push({ symbol, spreadPc, netProfitPc, buyDex: min.dex, sellDex: max.dex });
  });
  for (const o of allOpp) {
    const msg = `🔥 **HIGH-CONFIDENCE Opportunity!**\\n\\n` +
      `Token: *${o.symbol}*\\n` +
      `Gross spread: *${o.spreadPc.toFixed(2)}%*\\n` +
      `Est. net profit: *${o.netProfitPc.toFixed(2)}%*\\n` +
      `Buy: *${o.buyDex}*  –  Sell: *${o.sellDex}*`;
    await sendTelegram(msg);
  }
  console.log('Scan finished');
};

/* ---------- LIFECYCLE ---------- */
let running = true;
setInterval(() => running && scanOnce().catch(console.error), env.POLL_MS);
setInterval(updateTokenList, env.TOKEN_REFRESH_MS);
updateTokenList().then(() => scanOnce().catch(console.error));
process.on('SIGTERM', () => { running = false; console.log('SIGTERM – graceful exit'); });
process.on('SIGINT',  () => { running = false; console.log('SIGINT – graceful exit'); setTimeout(() => process.exit(0), 3_000); });

/* ---------- ENV ----------
TELEGRAM_BOT_TOKEN=xxx
CHAT_ID=yyy
DRY_RUN=false
*/
