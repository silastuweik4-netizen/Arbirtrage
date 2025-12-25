#!/usr/bin/env node
import fetch from 'node-fetch';
import { config } from 'dotenv';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getKeypair } from './wallet.js';
import { Server } from 'socket.io';
import express from 'express';
import http from 'http';
import { notify } from './telegram.js';
config();

/* ===================== CONFIG ===================== */
const RPC_URL = process.env.RPC_URL;
const JUP_API = 'https://quote-api.jup.ag/v7/quote';
const JITO_AUTH = process.env.JITO_AUTH_KEY;

const LOAN_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const BASE_TOKENS = [
  'So11111111111111111111111111111111111111112',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
];
const LOAN_AMOUNTS = [1000, 5000, 20000].map(v => v * 1e6);
const MIN_SPREAD = 0.002; // 0.2%
const MIN_USD = 10;
const SCAN_INTERVAL = 500;
const CACHE_TTL = 400;
const MAX_RETRIES = 2;

const conn = new Connection(RPC_URL, 'confirmed');
const keypair = getKeypair();
const quoteCache = new Map();

/* ===================== CACHE HELPERS ===================== */
function getCacheKey(dex, inputMint, outputMint, amount) {
  return `${dex}-${inputMint}-${outputMint}-${amount}`;
}
function setCache(key, data) { quoteCache.set(key, { data, timestamp: Date.now() }); }
function getCache(key) {
  const cached = quoteCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL) { quoteCache.delete(key); return null; }
  return cached.data;
}

/* ===================== FETCH HELPERS ===================== */
async function retryFetch(fn, retries = MAX_RETRIES) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 50)); }
  }
  throw lastErr;
}

async function getUsdcBalance() {
  const ata = await conn.getTokenAccountsByOwner(keypair.publicKey, { mint: LOAN_MINT });
  if (!ata.value.length) return 0;
  const bal = await conn.getTokenAccountBalance(ata.value[0].pubkey);
  return Number(bal.value.amount);
}

async function fetchDexQuote(dex, inputMint, outputMint, amount) {
  const key = getCacheKey(dex, inputMint, outputMint, amount);
  const cached = getCache(key);
  if (cached) return cached;

  const data = await retryFetch(async () => {
    let url;
    if (dex === 'JUP') {
      url = `${JUP_API}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50&onlyDirectRoutes=false`;
    } else if (dex === 'RAY') {
      url = `https://api.raydium.io/v2/sdk/liquidity?from=${inputMint}&to=${outputMint}&amount=${amount}`;
    } else if (dex === 'ORCA') {
      url = `https://api.orca.so/pool?from=${inputMint}&to=${outputMint}&amount=${amount}`;
    } else {
      throw new Error('Unknown DEX');
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`${dex} fetch failed with status ${res.status}`);
    const q = await res.json();

    if (dex === 'JUP') {
      if (!q.data || !q.data[0]) throw new Error('No Jupiter quote returned');
      q.outAmount = Number(q.data[0].outAmount);
      q.inAmount = Number(q.data[0].inAmount || amount);
      q.routePlan = q.data[0].routePlan || [];
    } else if (dex === 'RAY') {
      if (!q?.liquidity || !q?.outAmount) throw new Error('No Raydium quote returned');
      q.outAmount = Number(q.outAmount);
      q.inAmount = Number(amount);
      q.routePlan = [{ swapInfo: { liquidityAvailable: Number(q.liquidity) } }];
    } else if (dex === 'ORCA') {
      if (!q?.pool || !q?.outAmount) throw new Error('No Orca quote returned');
      q.outAmount = Number(q.outAmount);
      q.inAmount = Number(amount);
      q.routePlan = [{ swapInfo: { liquidityAvailable: Number(q.pool?.tokenA || amount) } }];
    }

    q.dex = dex;
    q.safeAmount = Math.floor(Math.min(...(q.routePlan?.map(h => h.swapInfo?.liquidityAvailable || amount) || [amount])) / 3);
    return q;
  });

  setCache(key, data);
  return data;
}

/* ===================== FLASH LOAN + JITO ===================== */
async function buildFlashTx(inputMint, outputMint, loanAmount) {
  const body = {
    token: inputMint.toString(),
    amount: loanAmount,
    user: keypair.publicKey.toString(),
    instructions: 'jupiter',
    inputMint: inputMint.toString(),
    outputMint: outputMint.toString(),
    finalMint: inputMint.toString(),
    slippageBps: 50,
    priorityFeeLamports: Math.max(10000, Math.floor(loanAmount * 0.0001))
  };
  const res = await fetch('https://api.kamino.finance/v1/flash-loan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) return null;
  const { tx } = await res.json();
  return Buffer.from(tx, 'base64');
}

async function submitJito(txSerialize) {
  const payload = { jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [[Array.from(txSerialize)]] };
  const res = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${JITO_AUTH}` },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Jito bundle error');
  const { result } = await res.json();
  return result;
}

/* ===================== ARB LOGIC ===================== */
async function checkBaseToken(baseMint) {
  const opportunities = [];
  for (const loan of LOAN_AMOUNTS) {
    try {
      const [jup, ray, orca] = await Promise.all([
        fetchDexQuote('JUP', LOAN_MINT.toString(), baseMint, loan),
        fetchDexQuote('RAY', LOAN_MINT.toString(), baseMint, loan),
        fetchDexQuote('ORCA', LOAN_MINT.toString(), baseMint, loan)
      ]);
      const quotes = [jup, ray, orca].filter(q => q);
      if (quotes.length < 2) continue;

      const minInput = Math.min(...quotes.map(q => Number(q.inAmount || loan)));
      const maxOutput = Math.max(...quotes.map(q => Number(q.outAmount || 0)));
      const spread = (maxOutput - minInput) / minInput;
      const profit = (maxOutput - minInput) / 1e6;
      const safeAmt = Math.floor(Math.min(...quotes.map(q => q.safeAmount || 0)) / 1.5);

      if (spread < MIN_SPREAD || profit < MIN_USD || safeAmt < loan) continue;

      opportunities.push({ baseMint, loan, safeAmt, profit, spread, quotes });
    } catch (e) { console.error('BaseToken error:', e.message); }
  }
  opportunities.sort((a, b) => (b.profit / b.safeAmt) - (a.profit / a.safeAmt));
  return opportunities[0] || null;
}

async function runMultiDexArb(io) {
  const promises = BASE_TOKENS.map(baseMint => checkBaseToken(baseMint));
  const results = await Promise.all(promises);
  const best = results.filter(r => r).sort((a, b) => (b.profit / b.safeAmt) - (a.profit / a.safeAmt))[0];
  if (!best) return null;

  io.emit('arbUpdate', best);

  const txB64 = await buildFlashTx(LOAN_MINT, best.baseMint, best.safeAmt);
  if (!txB64) return null;

  const tx = VersionedTransaction.deserialize(txB64);
  tx.sign([keypair]);

  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) return null;

  const usdcBefore = await getUsdcBalance();
  const bundleId = await submitJito(tx.serialize());
  await new Promise(r => setTimeout(r, 15000));
  const usdcAfter = await getUsdcBalance();
  const realised = (usdcAfter - usdcBefore) / 1e6;

  await notify(`<b>🚀 Cross-DEX Optimized Arb</b>\nBase: ${best.baseMint.slice(0,4)}…\nLoan: $${best.safeAmt/1e6}\nProfit: $${realised.toFixed(2)}\nSpread: ${(best.spread*100).toFixed(3)}%\nBundle: <code>${bundleId}</code>\nTime: ${new Date().toISOString()}`);

  return { status: 'executed', profit: realised, bundleId };
}

/* ===================== EXPRESS + DASHBOARD ===================== */
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

io.on('connection', (socket) => { console.log('Dashboard client connected'); });

async function microSlotLoop() {
  await runMultiDexArb(io);
  setTimeout(microSlotLoop, SCAN_INTERVAL);
}

/* ===================== START BOT + DASHBOARD ===================== */
server.listen(process.env.PORT || 3000, () => console.log('🚀 Dashboard + Arb Bot running on port 3000'));
microSlotLoop();
