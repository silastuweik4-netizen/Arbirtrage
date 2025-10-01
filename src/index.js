import express from 'express';
import fetch from 'node-fetch';
import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import pkg from '@pythnetwork/price-service-sdk';
const { PriceServiceConnection } = pkg;

import { SolendMarket } from '@solendprotocol/solend-sdk';
import { KaminoMarket } from '@kamino-finance/klend-sdk';
import { MarginfiClient, getConfig, MarginfiAccount } from '@mrgnlabs/marginfi-client-v2';
import { NodeWallet } from '@mrgnlabs/mrgn-common';
import { BN } from 'bn.js';
import { getAccount, createAssociatedTokenAccountInstruction, getAssociatedTokenAddress } from '@solana/spl-token';

const app = express();
const PORT = process.env.PORT || 10000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RPC_URL_HTTP = 'https://api.mainnet-beta.solana.com';
const RPC_URL_WS = 'wss://api.mainnet-beta.solana.com';

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    process.exit(1);
}

// --- Pyth Price Service ---
const PYTH_PRICE_SERVICE_URL = 'https://hermes.pyth.network/';
const pythConnection = new PriceServiceConnection(PYTH_PRICE_SERVICE_URL, { logger: console });

// --- Lending Protocol Config ---
const LENDING_PROGRAM_IDS = [
    new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo'), // Solend
    new PublicKey('6tTjZcMv6bLq5f7Z8tT58g7hGgqF3o8Y5h9gZ84r6q2n'), // Kamino
    new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA'), // Marginfi
];
const PROTOCOL_NAMES = new Map([
    ['So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', 'Solend'],
    ['6tTjZcMv6bLq5f7Z8tT58g7hGgqF3o8Y5h9gZ84r6q2n', 'Kamino'],
    ['MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', 'Marginfi'],
]);
const PROTOCOL_CLIENTS = new Map();
const activeObligationSubscriptions = new Map();
const LIQUIDATION_THRESHOLD_HEALTH_PERCENT = 105;

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// --- Telegram alert ---
async function sendTelegramAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' }),
        });
        if (!res.ok) throw new Error(`Telegram error: ${res.status}`);
        console.log('✅ Telegram alert sent.');
    } catch (err) {
        console.error('❌ Telegram error:', err);
    }
}

// --- Initialize Protocol Clients ---
async function initializeClients(connection) {
    try {
        const solendMarket = await SolendMarket.load(connection, 'production');
        PROTOCOL_CLIENTS.set('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', solendMarket);
        console.log('✅ Solend client initialized.');
    } catch (err) { console.error('❌ Solend init failed:', err); }

    try {
        const kaminoMarket = await KaminoMarket.load(connection, new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF'));
        PROTOCOL_CLIENTS.set('6tTjZcMv6bLq5f7Z8tT58g7hGgqF3o8Y5h9gZ84r6q2n', kaminoMarket);
        console.log('✅ Kamino client initialized.');
    } catch (err) { console.error('❌ Kamino init failed:', err); }

    try {
        const wallet = new NodeWallet(Keypair.generate());
        const config = getConfig('production');
        const marginfiClient = await MarginfiClient.fetch(config, wallet, connection);
        PROTOCOL_CLIENTS.set('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', marginfiClient);
        console.log('✅ Marginfi client initialized.');
    } catch (err) { console.error('❌ Marginfi init failed:', err); }
}

// --- Connect to Solana WebSocket ---
let connection;
async function connectToSolana() {
    connection = new Connection(RPC_URL_HTTP, { wsEndpoint: RPC_URL_WS });
    await initializeClients(connection);

    connection.getSlot().then(slot => console.log(`📡 Connected. Current slot: ${slot}`));

    for (const programId of LENDING_PROGRAM_IDS) {
        console.log(`🔔 Subscribing to logs for ${PROTOCOL_NAMES.get(programId.toBase58())}`);
        connection.onLogs({ mentions: [programId] }, logResult => handleLogMessage(logResult));
    }
}

// --- Fetch price from Pyth ---
async function fetchTokenPrice(tokenMint) {
    try {
        const feedIdMap = new Map([
            ['So11111111111111111111111111111111111111112', 'Crypto.SOL/USD'],
            ['EPjFWdd5AufqSSqeM2qN1xzybapT8G4wEGGkZwyGXGfX', 'Crypto.USDC/USD'],
            ['Es9vMFrzaCERmJfrF4H2cpdgYQFWpmBLHWzJBNqJZV1W', 'Crypto.USDT/USD'],
        ]);
        const feedId = feedIdMap.get(tokenMint.toBase58());
        if (!feedId) return 0;

        const priceFeeds = await pythConnection.getLatestPriceFeeds([feedId]);
        const price = priceFeeds?.getPriceUnchecked();
        return price ? parseFloat(price.price) * Math.pow(10, price.expo) : 0;
    } catch (err) {
        console.error('❌ Price fetch error:', err);
        return 0;
    }
}

// --- Handle log messages ---
async function handleLogMessage(logResult) {
    const { signature, logs } = logResult;
    if (!logs || !logs.join(' ').includes('Instruction: LiquidateObligation')) return;

    console.log(`🔥 Liquidation detected in Tx: ${signature}`);
    await sendTelegramAlert(`🔥 *Liquidation detected!* Tx: https://solscan.io/tx/${signature}`);
}

// --- Express server ---
app.get('/', (req, res) => res.send('✅ Solana Lending Liquidation Tracker running.'));
app.listen(PORT, async () => {
    console.log(`🌐 Server listening on port ${PORT}`);
    await sendTelegramAlert('✅ Solana Lending Liquidation Tracker started and Telegram alerts active!');
    await connectToSolana();
});
