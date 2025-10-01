// src/index.js
import express from 'express';
import fetch from 'node-fetch';
import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import pkg from '@pythnetwork/price-service-sdk';
const { PriceServiceConnection } = pkg;
import { SolendMarket } from '@solendprotocol/solend-sdk';
import { BN } from 'bn.js';
import { getAccount, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';

// === Configuration ===
const app = express();
const PORT = process.env.PORT || 10000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    process.exit(1);
}

// Solana RPC
const connection = new Connection('https://api.mainnet-beta.solana.com', {
    wsEndpoint: 'wss://api.mainnet-beta.solana.com'
});

// Pyth price service
const pythConnection = new PriceServiceConnection('https://hermes.pyth.network/', { logger: console });

// Lending programs
const LENDING_PROGRAM_IDS = [
    new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo'), // Solend
    new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA'), // Marginfi v2
];

const PROTOCOL_NAMES = new Map([
    ['So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', 'Solend'],
    ['MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', 'Marginfi v2'],
]);

const PROTOCOL_CLIENTS = new Map();
const activeObligationSubscriptions = new Map();
const LIQUIDATION_THRESHOLD_HEALTH_PERCENT = 105;

// === Telegram Helper ===
async function sendTelegramAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' }),
        });
        if (!response.ok) throw new Error(`Telegram API error: ${response.status}`);
        console.log('✅ Telegram alert sent.');
    } catch (err) {
        console.error('❌ Telegram error:', err);
    }
}

// === Initialize Solend Client ===
async function initializeClients() {
    try {
        const solendMarket = await SolendMarket.load(connection, 'production');
        PROTOCOL_CLIENTS.set('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', solendMarket);
        console.log('✅ Initialized Solend Client.');
    } catch (err) {
        console.error('❌ Failed to initialize Solend client:', err);
    }
}

// === Obligation subscription ===
function subscribeToObligationAccount(pubkey, programId) {
    const keyStr = pubkey.toBase58();
    if (activeObligationSubscriptions.has(keyStr)) return;

    const subId = connection.onAccountChange(pubkey, async (accountInfo) => {
        try {
            await handleObligationAccountChange(pubkey, accountInfo, programId);
        } catch (err) {
            console.error(`❌ Error for obligation ${keyStr}:`, err);
        }
    }, 'confirmed');

    activeObligationSubscriptions.set(keyStr, { subId, lastHealth: 0 });
    console.log(`👂 Subscribed to obligation ${keyStr}`);
}

// === Fetch token price from Pyth ===
async function fetchTokenPrice(tokenMint) {
    try {
        const tokenMap = new Map([
            ['So11111111111111111111111111111111111111112', 'Crypto.SOL/USD'],
            ['EPjFWdd5AufqSSqeM2qN1xzybapT8G4wEGGkZwyGXGfX', 'Crypto.USDC/USD'],
            ['Es9vMFrzaCERmJfrF4H2cpdgYQFWpmBLHWzJBNqJZV1W', 'Crypto.USDT/USD'],
            ['mSoLzYCxvsx2EuUxXfABpgZ2sRk2d4Fsoj9Tykd7Dsd', 'Crypto.mSOL/USD'],
        ]);
        const feedId = tokenMap.get(tokenMint.toBase58());
        if (!feedId) return 0;

        const priceFeeds = await pythConnection.getLatestPriceFeeds([feedId]);
        const price = priceFeeds?.getPriceUnchecked();
        if (price) return parseFloat(price.price) * Math.pow(10, price.expo);
        return 0;
    } catch {
        return 0;
    }
}

// === Handle Obligation Account Change ===
async function handleObligationAccountChange(pubkey, accountInfo, programId) {
    const protocolName = PROTOCOL_NAMES.get(programId.toBase58()) || 'Unknown';
    let currentHealth = 0;

    if (programId.toBase58() === 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo') {
        const solendMarket = PROTOCOL_CLIENTS.get(programId.toBase58());
        const obligation = solendMarket.decodeObligation(pubkey, accountInfo.data);
        currentHealth = await calculateSolendHealth(solendMarket, obligation);
    }

    const subInfo = activeObligationSubscriptions.get(pubkey.toBase58());
    if (subInfo && subInfo.lastHealth === currentHealth) return;
    if (subInfo) subInfo.lastHealth = currentHealth;

    console.log(`📊 ${protocolName} Obligation ${pubkey.toBase58()} Health: ${currentHealth.toFixed(2)}%`);

    if (currentHealth < LIQUIDATION_THRESHOLD_HEALTH_PERCENT) {
        const message = `⚡️ *ALERT: ${protocolName} Obligation Near Liquidation!*
- Obligation: \`${pubkey.toBase58()}\`
- Health: *${currentHealth.toFixed(2)}%*`;
        await sendTelegramAlert(message);
    }
}

// === Calculate Solend Health ===
async function calculateSolendHealth(solendMarket, decodedObligation) {
    await solendMarket.loadReserves();
    const collateralValue = solendMarket.getDepositsValue(decodedObligation.deposits);
    const borrowValue = solendMarket.getBorrowsValue(decodedObligation.borrows);
    return borrowValue === 0 ? 10000 : (collateralValue / borrowValue) * 100;
}

// === Discover and subscribe obligations ===
async function discoverObligations() {
    for (const programId of LENDING_PROGRAM_IDS) {
        if (programId.toBase58() === 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA') continue; // skip Marginfi proactive
        const accounts = await connection.getProgramAccounts(programId);
        for (const account of accounts) subscribeToObligationAccount(account.pubkey, programId);
        console.log(`✅ Subscribed to ${accounts.length} obligations for ${PROTOCOL_NAMES.get(programId.toBase58())}`);
    }
}

// === Connect to Solana and subscribe to logs ===
async function connectToSolana() {
    await initializeClients();
    await discoverObligations();

    connection.onLogs(
        { mentions: LENDING_PROGRAM_IDS },
        async (logResult) => {
            const { signature } = logResult;
            if (logResult.logs.join(' ').includes('Instruction: LiquidateObligation')) {
                console.log(`🔥 Liquidation log detected: ${signature}`);
                await sendTelegramAlert(`🔥 Liquidation detected! Tx: https://solscan.io/tx/${signature}`);
            }
        },
        'confirmed'
    );

    const slot = await connection.getSlot();
    console.log(`📡 Solana connection healthy, current slot: ${slot}`);
}

// === Express server ===
app.get('/', (req, res) => {
    res.send('✅ Solana Lending Liquidation Tracker is running...');
});

app.listen(PORT, async () => {
    console.log(`🌐 Server listening on port ${PORT}`);
    await sendTelegramAlert('✅ Solana Lending Liquidation Tracker started and Telegram alerts active!');
    await connectToSolana();
});
