import express from 'express';
import fetch from 'node-fetch';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { PriceServiceConnection } from '@pythnetwork/price-service-sdk';
import { SolendMarket } from '@solendprotocol/solend-sdk';
import { MarginfiClient, getConfig, MarginfiAccount } from '@mrgnlabs/marginfi-client-v2';
import { NodeWallet } from '@mrgnlabs/mrgn-common';

const app = express();
const PORT = process.env.PORT || 10000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RPC_URL_HTTP = 'https://api.mainnet-beta.solana.com';
const RPC_URL_WS = 'wss://api.mainnet-beta.solana.com';

const PYTH_PRICE_SERVICE_URL = 'https://hermes.pyth.network/';
const pythConnection = new PriceServiceConnection(PYTH_PRICE_SERVICE_URL, { logger: console });

const LENDING_PROGRAM_IDS = [
  new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo'), // Solend
  new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA'), // Marginfi v2
  new PublicKey('6tTjZcMv6bLq5f7Z8tT58g7hGgqF3o8Y5h9gZ84r6q2n'), // Kamino (reactive only)
];

const PROTOCOL_NAMES = new Map([
  ['So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', 'Solend'],
  ['MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', 'Marginfi v2'],
  ['6tTjZcMv6bLq5f7Z8tT58g7hGgqF3o8Y5h9gZ84r6q2n', 'Kamino'],
]);

const PROTOCOL_CLIENTS = new Map();
const activeObligationSubscriptions = new Map();
const LIQUIDATION_THRESHOLD_HEALTH_PERCENT = 105;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  process.exit(1);
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// --- Telegram Alert ---
async function sendTelegramAlert(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Telegram API error: ${response.status} ${errorText}`);
    }
    console.log('✅ Telegram alert sent.');
  } catch (err) {
    console.error('❌ Telegram error:', err);
  }
}

// --- Initialize Clients ---
async function initializeClients(connection) {
  try {
    const solendMarket = await SolendMarket.load(connection, 'production');
    PROTOCOL_CLIENTS.set('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', solendMarket);
    console.log('✅ Initialized Solend Client.');
  } catch (err) { console.error('❌ Solend init failed:', err); }

  try {
    const wallet = new NodeWallet(Keypair.generate());
    const config = getConfig('production');
    const marginfiClient = await MarginfiClient.fetch(config, wallet, connection);
    PROTOCOL_CLIENTS.set('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', marginfiClient);
    console.log('✅ Initialized Marginfi Client.');
  } catch (err) { console.error('❌ Marginfi init failed:', err); }
}

// --- Solana Connection ---
let connection;
async function connectToSolana() {
  console.log('🔌 Connecting to Solana RPC WebSocket...');
  connection = new Connection(RPC_URL_HTTP, { wsEndpoint: RPC_URL_WS });

  await initializeClients(connection);

  // --- Reactive: subscribe to all logs ---
  connection.onLogs({ mentions: LENDING_PROGRAM_IDS }, handleLogMessage, 'confirmed');

  // --- Proactive: fetch obligations ---
  await discoverAndSubscribeObligations();

  const slot = await connection.getSlot();
  console.log(`📡 Connection healthy, current slot: ${slot}`);
}

// --- Obligation Discovery & Subscription ---
async function discoverAndSubscribeObligations() {
  console.log('⏳ Discovering active obligations...');
  for (const programId of LENDING_PROGRAM_IDS) {
    const protocolName = PROTOCOL_NAMES.get(programId.toBase58());
    if (protocolName === 'Kamino') continue; // reactive only

    try {
      let filters = [];
      if (protocolName === 'Solend') filters.push({ memcmp: { offset: 0, bytes: Buffer.from('obligationv2','utf8').toString('base64') } });
      const accounts = await connection.getProgramAccounts(programId, { filters });
      console.log(`✅ Found ${accounts.length} obligations for ${protocolName}`);
      for (const account of accounts) subscribeToObligationAccount(account.pubkey, programId);
    } catch (err) { console.error(`❌ Error fetching obligations for ${protocolName}:`, err); }
  }
}

function subscribeToObligationAccount(obligationPubKey, programId) {
  const keyStr = obligationPubKey.toBase58();
  if (activeObligationSubscriptions.has(keyStr)) return;

  console.log(`👂 Subscribing to obligation: ${keyStr}`);
  const subId = connection.onAccountChange(obligationPubKey, async (accountInfo) => {
    await handleObligationAccountChange(obligationPubKey, accountInfo, programId);
  }, 'confirmed');

  activeObligationSubscriptions.set(keyStr, { subId, lastHealth: 0 });
}

// --- Handle Obligation Change ---
async function handleObligationAccountChange(obligationPubKey, accountInfo, programId) {
  const protocolName = PROTOCOL_NAMES.get(programId.toBase58());
  let health = 0;

  try {
    switch(protocolName) {
      case 'Solend':
        const solendMarket = PROTOCOL_CLIENTS.get(programId.toBase58());
        const obligation = solendMarket.decodeObligation(obligationPubKey, accountInfo.data);
        if (obligation) health = await calculateSolendHealth(solendMarket, obligation);
        break;
      case 'Marginfi v2':
        const marginfiClient = PROTOCOL_CLIENTS.get(programId.toBase58());
        const marginfiAccount = await MarginfiAccount.fetch(obligationPubKey, marginfiClient);
        health = marginfiAccount.computeHealthRatio('initial') * 100;
        break;
      default: return;
    }
  } catch (err) { console.error(`❌ Health calc error for ${protocolName}:`, err); return; }

  if (!health || isNaN(health)) return;

  const subInfo = activeObligationSubscriptions.get(obligationPubKey.toBase58());
  if (subInfo && subInfo.lastHealth === health) return;
  if (subInfo) subInfo.lastHealth = health;

  console.log(`📊 ${protocolName} obligation ${obligationPubKey.toBase58()} health: ${health.toFixed(2)}%`);

  if (health < LIQUIDATION_THRESHOLD_HEALTH_PERCENT) {
    console.log(`🚨 ${protocolName} obligation near liquidation!`);
    await sendTelegramAlert(`⚡️ *ALERT: ${protocolName} Pre-Liquidation!*\n- Obligation: \`${obligationPubKey.toBase58()}\`\n- Health: *${health.toFixed(2)}%*`);
  }
}

// --- Solend Health ---
async function calculateSolendHealth(solendMarket, obligation) {
  await solendMarket.loadReserves();
  const deposits = obligation.deposits.map(d => ({...d, market: solendMarket.reserves.find(r=>r.config.reserveAddress.equals(d.reserve)).market}));
  const borrows = obligation.borrows.map(b => ({...b, market: solendMarket.reserves.find(r=>r.config.reserveAddress.equals(b.reserve)).market}));
  const collateralValue = solendMarket.getDepositsValue(deposits);
  const borrowValue = solendMarket.getBorrowsValue(borrows);
  if (borrowValue === 0) return 10000;
  return (collateralValue / borrowValue) * 100;
}

// --- Reactive Log Handler ---
async function handleLogMessage(logResult) {
  const { logs, signature } = logResult;
  if (!logs.join(' ').includes('LiquidateObligation')) return;

  console.log(`🔥 Liquidation detected: ${signature}`);
  await sendTelegramAlert(`🔥 Liquidation detected in transaction ${signature}`);
}

// --- Express Server ---
app.get('/', (req, res) => res.send('✅ Solana Lending Liquidation Tracker is running...'));

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await connectToSolana();
});
