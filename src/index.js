import express from 'express';
import fetch from 'node-fetch';
import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction } from '@solana/web3.js';
import { PriceServiceConnection } from '@pythnetwork/price-feeder';
import { SolendMarket } from '@solendprotocol/solend-sdk';
import { KaminoMarket } from '@kamino-finance/klend-sdk';
import { MarginfiClient, getConfig, MarginfiAccount, Bank } from '@mrgnlabs/marginfi-client-v2';
import { NodeWallet } from '@mrgnlabs/mrgn-common';
import { BN } from 'bn.js';
import { TOKEN_PROGRAM_ID, getAccount, createAssociatedTokenAccountInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import { createAssociatedTokenAccount } from '@solana/spl-token';
import { findProgramAddressSync } from '@project-serum/anchor'; // Assuming anchor library is available


// === Configuration ===
const app = express();
const PORT = process.env.PORT || 10000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RPC_URL_HTTP = 'https://api.mainnet-beta.solana.com';
const RPC_URL_WS = 'wss://api.mainnet-beta.solana.com';

const PYTH_PRICE_SERVICE_URL = 'https://hermes.pyth.network/';
const pythConnection = new PriceServiceConnection(PYTH_PRICE_SERVICE_URL, {
    logger: console,
});

// Define the PublicKeys for all lending protocols you want to track
const LENDING_PROGRAM_IDS = [
    new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo'), // Solend (Save Finance)
    new PublicKey('6tTjZcMv6bLq5f7Z8tT58g7hGgqF3o8Y5h9gZ84r6q2n'), // Kamino Finance
    new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA'), // Marginfi v2
];

const PROTOCOL_NAMES = new Map([
    ['So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', 'Solend (Save Finance)'],
    ['6tTjZcMv6bLq5f7Z8tT58g7hGgqF3o8Y5h9gZ84r6q2n', 'Kamino Finance'],
    ['MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', 'Marginfi v2'],
]);

const PROTOCOL_CLIENTS = new Map();
const PROTOCOL_ACCOUNT_INFO = new Map([
    ['MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', { discriminator: Buffer.from('f29910d517112028', 'hex') }],
    // TODO: Determine the actual data size and/or discriminator for Solend and Kamino obligation accounts
    ['So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', { dataSize: 1300 }],
]);

const activeObligationSubscriptions = new Map();
const LIQUIDATION_THRESHOLD_HEALTH_PERCENT = 105;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    process.exit(1);
}

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

async function sendTelegramAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown',
            }),
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

async function initializeClients(connection) {
    try {
        const solendMarket = await SolendMarket.load(connection, 'production');
        PROTOCOL_CLIENTS.set('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', solendMarket);
        console.log('✅ Initialized Solend Client.');
    } catch (err) {
        console.error('❌ Failed to initialize Solend client:', err);
    }
    
    try {
        const kaminoMarket = await KaminoMarket.load(connection, new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF'));
        PROTOCOL_CLIENTS.set('6tTjZcMv6bLq5f7Z8tT58g7hGgqF3o8Y5h9gZ84r6q2n', kaminoMarket);
        console.log('✅ Initialized Kamino Client.');
    } catch (err) {
        console.error('❌ Failed to initialize Kamino client:', err);
    }

    try {
        const wallet = new NodeWallet(Keypair.generate());
        const config = getConfig('production');
        const marginfiClient = await MarginfiClient.fetch(config, wallet, connection);
        PROTOCOL_CLIENTS.set('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', marginfiClient);
        console.log('✅ Initialized Marginfi Client.');
    } catch (err) {
        console.error('❌ Failed to initialize Marginfi client:', err);
    }
}

async function connectToSolana() {
    console.log('🔌 Connecting to Solana RPC WebSocket...');

    connection = new Connection(RPC_URL_HTTP, { wsEndpoint: RPC_URL_WS });
    await initializeClients(connection);

    try {
        const logSubscriptionId = connection.onLogs(
            { mentions: LENDING_PROGRAM_IDS },
            (logResult) => {
                handleLogMessage(logResult).catch(err => {
                    console.error('❌ Error in handleLogMessage:', err);
                });
            },
            'confirmed'
        );
        console.log('✅ Subscribed to lending protocol logs with ID:', logSubscriptionId);
    } catch (err) {
        console.error('❌ Failed to subscribe to lending protocol logs:', err);
    }

    await discoverAndSubscribeObligations();

    connection.getSlot().then(slot => {
        console.log(`📡 Connection healthy, current slot: ${slot}`);
    }).catch(err => {
        console.error('❌ Connection health check failed:', err);
    });
}

function subscribeToObligationAccount(obligationAccountPubKey, programId) {
    const keyString = obligationAccountPubKey.toString();
    if (activeObligationSubscriptions.has(keyString)) {
        console.log(`ℹ️ Already subscribed to obligation account: ${keyString}`);
        return;
    }

    console.log(`👂 Subscribing to obligation account: ${keyString}`);
    const subId = connection.onAccountChange(
        obligationAccountPubKey,
        (accountInfo) => {
            handleObligationAccountChange(obligationAccountPubKey, accountInfo, programId).catch(err => {
                console.error(`❌ Error handling account change for ${keyString}:`, err);
            });
        },
        'confirmed'
    );
    activeObligationSubscriptions.set(keyString, { subId, lastHealth: 0 });
}

async function fetchTokenPrice(tokenMint) {
    try {
        const tokenMap = new Map([
            ['So11111111111111111111111111111111111111112', 'Crypto.SOL/USD'],
            ['EPjFWdd5AufqSSqeM2qN1xzybapT8G4wEGGkZwyGXGfX', 'Crypto.USDC/USD'],
            ['Es9vMFrzaCERmJfrF4H2cpdgYQFWpmBLHWzJBNqJZV1W', 'Crypto.USDT/USD'],
            ['mSoLzYCxvsx2EuUxXfABpgZ2sRk2d4Fsoj9Tykd7Dsd', 'Crypto.MSOL/USD'],
        ]);
        const feedId = tokenMap.get(tokenMint.toBase58());

        if (!feedId) {
            console.warn(`⚠️ No Pyth feed ID found for token mint: ${tokenMint.toBase58()}`);
            return 0;
        }

        const priceFeeds = await pythConnection.getLatestPriceFeeds([feedId]);
        const price = priceFeeds?.getPriceUnchecked();
        if (price) {
            return parseFloat(price.price) * Math.pow(10, price.expo);
        }
        console.warn(`⚠️ Could not fetch price for ${tokenMint.toBase58()} from Pyth.`);
        return 0;
    } catch (err) {
        console.error(`❌ Error fetching price for ${tokenMint.toBase58()} from Pyth:`, err);
        return 0;
    }
}

async function handleObligationAccountChange(obligationAccountPubKey, accountInfo, programId) {
    const protocolName = PROTOCOL_NAMES.get(programId.toBase58()) || `Unknown (${programId.toBase58()})`;

    let currentHealthRatio = 0;
    try {
        switch (programId.toString()) {
            case 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo': {
                const solendMarket = PROTOCOL_CLIENTS.get(programId.toBase58());
                const obligation = solendMarket.decodeObligation(obligationAccountPubKey, accountInfo.data);
                if (obligation) {
                    currentHealthRatio = await calculateSolendHealth(solendMarket, obligation);
                }
                break;
            }
            case '6tTjZcMv6bLq5f7Z8tT58g7hGgqF3o8Y5h9gZ84r6q2n': {
                console.log(`ℹ️ Proactive monitoring for Kamino is disabled. Skipping account ${obligationAccountPubKey.toBase58()}`);
                return;
            }
            case 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA': {
                const marginfiClient = PROTOCOL_CLIENTS.get(programId.toBase58());
                const marginfiAccount = await MarginfiAccount.fetch(obligationAccountPubKey, marginfiClient);
                if (marginfiAccount) {
                    currentHealthRatio = marginfiAccount.computeHealthRatio('initial') * 100;
                }
                break;
            }
            default:
                console.warn(`⚠️ Unhandled protocol for account change: ${protocolName}`);
                return;
        }
    } catch (err) {
        console.error(`❌ Error processing obligation account change for ${protocolName}:`, err);
        return;
    }

    if (currentHealthRatio === 0 || isNaN(currentHealthRatio)) {
        console.warn(`⚠️ Health could not be determined for ${protocolName} obligation ${obligationAccountPubKey.toBase58()}.`);
        return;
    }

    const subInfo = activeObligationSubscriptions.get(obligationAccountPubKey.toString());
    if (subInfo && subInfo.lastHealth === currentHealthRatio) {
        return;
    }
    if (subInfo) subInfo.lastHealth = currentHealthRatio;

    console.log(`📊 ${protocolName} Obligation ${obligationAccountPubKey.toBase58()} Health: ${currentHealthRatio.toFixed(2)}%`);

    if (currentHealthRatio < LIQUIDATION_THRESHOLD_HEALTH_PERCENT) {
        console.log(`🚨 ${protocolName} Obligation ${obligationAccountPubKey.toBase58()} is near liquidation threshold (${currentHealthRatio.toFixed(2)}%)!`);
        const liquidationSimulationResult = await simulateLiquidation(obligationAccountPubKey, programId);

        if (liquidationSimulationResult.isLiquidatable) {
            const tokenPrice = await fetchTokenPrice(liquidationSimulationResult.estimatedTokenMint);
            const usdValue = tokenPrice > 0 ? (liquidationSimulationResult.estimatedAmount * tokenPrice).toFixed(2) : 'N/A';

            const message = `⚡️ *PROACTIVE ALERT: ${protocolName} Liquidation Likely!*
- Obligation: \`${obligationAccountPubKey.toBase58()}\`
- Health: *${currentHealthRatio.toFixed(2)}%* (below ${LIQUIDATION_THRESHOLD_HEALTH_PERCENT}%)
- Estimated Liquidation: ${liquidationSimulationResult.estimatedAmount || 'N/A'} ${liquidationSimulationResult.estimatedTokenSymbol || ''} (~$${usdValue} USD)
- Status: ${liquidationSimulationResult.status}
- Explorers:
  - [Solscan](https://solscan.io/tx/${liquidationSimulationResult.signature || 'N/A'})
  - [SolanaFM](https://solana.fm/tx/${liquidationSimulationResult.signature || 'N/A'})
  - [X-Ray](https://xray.helius.xyz/tx/${liquidationSimulationResult.signature || 'N/A'})
_Prepare for potential liquidation!_`;
            await sendTelegramAlert(message);
        } else {
            console.log(`ℹ️ Simulation shows ${protocolName} Obligation ${obligationAccountPubKey.toBase58()} is NOT currently liquidatable: ${liquidationSimulationResult.status}`);
        }
    }
}

async function simulateLiquidation(obligationAccountPubKey, programId) {
    const protocolName = PROTOCOL_NAMES.get(programId.toBase58()) || `Unknown (${programId.toBase58()})`;
    console.log(`🧪 Simulating liquidation for ${protocolName} obligation ${obligationAccountPubKey.toBase58()}...`);

    try {
        let liquidationInstruction;
        let estimatedAmount = 0;
        let estimatedTokenMint = new PublicKey(0);
        let estimatedTokenSymbol = '';
        const liquidatorWallet = new NodeWallet(Keypair.generate());

        switch (programId.toString()) {
            case 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo': {
                const solendMarket = PROTOCOL_CLIENTS.get(programId.toBase58());
                const liquidatee = obligationAccountPubKey;
                const { repayReserve, withdrawReserve, amount, tokenMint } = await getSolendLiquidationDetails(solendMarket, liquidatee);
                if (repayReserve && withdrawReserve) {
                    const liquidatorRepayTokenAccount = await getOrCreateAssociatedTokenAccount(connection, liquidatorWallet.keypair, repayReserve.config.borrowMint, liquidatorWallet.publicKey);
                    const liquidatorWithdrawTokenAccount = await getOrCreateAssociatedTokenAccount(connection, liquidatorWallet.keypair, withdrawReserve.config.borrowMint, liquidatorWallet.publicKey);
                    
                    liquidationInstruction = await solendMarket.liquidateObligation({
                        obligation: liquidatee,
                        repayReserve,
                        withdrawReserve,
                        repayAmount: new BN(amount),
                        liquidator: liquidatorWallet.publicKey,
                        repayTokenAccount: liquidatorRepayTokenAccount.address,
                        withdrawTokenAccount: liquidatorWithdrawTokenAccount.address,
                    });
                    estimatedAmount = amount;
                    estimatedTokenMint = tokenMint;
                    estimatedTokenSymbol = mapTokenMintToSymbol(tokenMint);
                }
                break;
            }
            case '6tTjZcMv6bLq5f7Z8tT58g7hGgqF3o8Y5h9gZ84r6q2n': {
                console.warn('⚠️ Kamino liquidation instruction building not implemented.');
                break;
            }
            case 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA': {
                const marginfiClient = PROTOCOL_CLIENTS.get(programId.toBase58());
                const marginfiAccount = await MarginfiAccount.fetch(obligationAccountPubKey, marginfiClient);
                const { repayBank, seizeBank, amountToRepay, tokenMintToRepay } = await findOptimalMarginfiLiquidation(marginfiAccount, marginfiClient);
                if (repayBank && seizeBank) {
                    liquidationInstruction = await marginfiClient.makeLiquidateInstruction(marginfiAccount.publicKey, liquidatorWallet.publicKey, amountToRepay, repayBank.publicKey, seizeBank.publicKey, liquidatorWallet.publicKey);
                    estimatedAmount = amountToRepay;
                    estimatedTokenMint = tokenMintToRepay;
                    estimatedTokenSymbol = mapTokenMintToSymbol(tokenMintToRepay);
                }
                break;
            }
        }

        if (liquidationInstruction) {
            const transaction = new Transaction().add(liquidationInstruction);
            const simResult = await connection.simulateTransaction(transaction, [liquidatorWallet.keypair]);

            if (simResult.value.err) {
                console.log(`Simulation failed for ${obligationAccountPubKey.toBase58()}:`, simResult.value.err);
                return { isLiquidatable: false, status: JSON.stringify(simResult.value.err), estimatedAmount: null, estimatedTokenMint: null, estimatedTokenSymbol: '', signature: '' };
            } else {
                console.log(`Simulation successful for ${obligationAccountPubKey.toBase58()}`);
                return { isLiquidatable: true, status: 'SUCCESS (simulated)', estimatedAmount, estimatedTokenMint, estimatedTokenSymbol, signature: obligationAccountPubKey.toBase58() };
            }
        }
    } catch (simErr) {
        console.error(`❌ Error during simulation for ${protocolName} obligation ${obligationAccountPubKey.toBase58()}:`, simErr);
    }
    return { isLiquidatable: false, status: 'Simulation failed (unknown reason)', estimatedAmount: null, estimatedTokenMint: null, estimatedTokenSymbol: '', signature: '' };
}

async function handleLogMessage(logResult) {
    const { logs, signature } = logResult;

    if (logs && logs.join(' ').includes('Instruction: LiquidateObligation')) {
        console.log(`🔍 Reactive liquidation alert: ${signature}`);
        let transaction;
        try {
            transaction = await connection.getParsedTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            });
        } catch (err) {
            console.error(`❌ Failed to fetch transaction ${signature}:`, err);
            return;
        }

        if (!transaction) {
            console.warn(`⚠️ Transaction ${signature} not found. Skipping reactive alert.`);
            return;
        }
        
        for (const instruction of transaction.transaction.message.instructions) {
            if (instruction.programId && LENDING_PROGRAM_IDS.some(id => id.equals(instruction.programId))) {
                const protocolName = PROTOCOL_NAMES.get(instruction.programId.toBase58()) || `Unknown (${instruction.programId.toBase58()})`;

                if (instruction.parsed?.type === 'liquidateObligation') {
                    const { borrower, amount, tokenMint, tokenSymbol } = parseLiquidationInstruction(instruction);
                    const tokenPrice = await fetchTokenPrice(tokenMint);
                    const usdValue = tokenPrice > 0 ? (amount * tokenPrice).toFixed(2) : 'N/A';

                    const message = `🔥 *${protocolName} Liquidation Detected!*
- Instruction: \`liquidateObligation\`
- Borrower: \`${borrower}\`
- Token: ${tokenSymbol}
- Amount: ${amount} (~$${usdValue} USD)
- Explorers:
  - [Solscan](https://solscan.io/tx/${signature})
  - [SolanaFM](https://solana.fm/tx/${signature})
  - [X-Ray](https://xray.helius.xyz/tx/${signature})
- Tx: https://solscan.io/tx/${signature}`;
                    console.log(message);
                    await sendTelegramAlert(message);
                } else {
                    console.warn(`⚠️ Detected log for ${protocolName} but could not confirm specific liquidation instruction type for Tx: ${signature}. Falling back to log parsing is no longer used.`);
                }
                break;
            }
        }
    }
}

function parseLiquidationInstruction(instruction) {
    const data = instruction.parsed;

    if (!data || !data.info) {
        console.warn(`⚠️ Instruction data not fully parsed for:`, instruction);
        return { borrower: 'N/A', amount: 0, tokenMint: new PublicKey(0), tokenSymbol: 'N/A' };
    }

    const borrower = data.info.borrower || 'N/A';
    const amount = parseFloat(data.info.amount) || 0;
    const tokenMintStr = data.info.tokenMint?.toBase58() || data.info.tokenAccount || 'N/A';
    const tokenMint = new PublicKey(tokenMintStr);

    return { borrower, amount, tokenMint, tokenSymbol: mapTokenMintToSymbol(tokenMint) };
}

function mapTokenMintToSymbol(tokenMint) {
    const tokenMap = new Map([
        ['So11111111111111111111111111111111111111112', 'SOL'],
        ['EPjFWdd5AufqSSqeM2qN1xzybapT8G4wEGGkZwyGXGfX', 'USDC'],
        ['Es9vMFrzaCERmJfrF4H2cpdgYQFWpmBLHWzJBNqJZV1W', 'USDT'],
        ['mSoLzYCxvsx2EuUxXfABpgZ2sRk2d4Fsoj9Tykd7Dsd', 'mSOL'],
    ]);
    return tokenMap.get(tokenMint.toBase58()) || tokenMint.toBase58().slice(0, 8) + '...' || 'Unknown Token';
}

async function discoverAndSubscribeObligations() {
    console.log('⏳ Discovering active obligation accounts...');
    for (const programId of LENDING_PROGRAM_IDS) {
        try {
            if (programId.toBase58() === '6tTjZcMv6bLq5f7Z8tT58g7hGgqF3o8Y5h9gZ84r6q2n') {
                console.log(`ℹ️ Proactive monitoring skipped for Kamino as requested.`);
                continue;
            }

            console.log(`Searching for accounts for protocol: ${PROTOCOL_NAMES.get(programId.toBase58()) || programId.toBase58()}`);
            let filters = [];
            const protocolInfo = PROTOCOL_ACCOUNT_INFO.get(programId.toBase58());
            if (protocolInfo?.discriminator) {
                filters.push({ memcmp: { offset: 0, bytes: protocolInfo.discriminator.toString('base64') } });
            }

            const accounts = await connection.getProgramAccounts(programId, { filters });

            for (const account of accounts) {
                subscribeToObligationAccount(account.pubkey, programId);
            }
            console.log(`✅ Found and subscribed to ${accounts.length} accounts for ${PROTOCOL_NAMES.get(programId.toBase58()) || programId.toBase58()}.`);
        } catch (err) {
            console.error(`❌ Error discovering accounts for ${programId.toBase58()}:`, err);
        }
    }
    console.log('✅ Discovery complete. Subscriptions established.');
}

async function calculateSolendHealth(solendMarket, decodedObligation) {
    try {
        await solendMarket.loadReserves();
        const deposits = decodedObligation.deposits.map(deposit => ({
            ...deposit,
            market: solendMarket.reserves.find(r => r.config.reserveAddress.equals(deposit.reserve)).market,
        }));
        const borrows = decodedObligation.borrows.map(borrow => ({
            ...borrow,
            market: solendMarket.reserves.find(r => r.config.reserveAddress.equals(borrow.reserve)).market,
        }));
        const collateralValue = solendMarket.getDepositsValue(deposits);
        const borrowValue = solendMarket.getBorrowsValue(borrows);
        if (borrowValue === 0) return 10000;
        return (collateralValue / borrowValue) * 100;
    } catch (err) {
        console.error('❌ Error calculating Solend health:', err);
        return 0;
    }
}

async function getSolendLiquidationDetails(solendMarket, obligationPubKey) {
    await solendMarket.loadReserves();
    const obligation = await solendMarket.fetchObligation(obligationPubKey);
    if (!obligation) throw new Error("Obligation not found");

    const borrow = obligation.borrows[0];
    const deposit = obligation.deposits[0];
    
    return {
        repayReserve: solendMarket.reserves.find(r => r.config.reserveAddress.equals(borrow.reserve)),
        withdrawReserve: solendMarket.reserves.find(r => r.config.reserveAddress.equals(deposit.reserve)),
        amount: borrow.amount,
        tokenMint: borrow.tokenMint,
    };
}

async function findOptimalMarginfiLiquidation(marginfiAccount, marginfiClient) {
    // Basic greedy strategy: find the largest borrow and largest collateral.
    const largestBorrow = marginfiAccount.borrows.sort((a, b) => b.amount - a.amount)[0];
    const largestCollateral = marginfiAccount.deposits.sort((a, b) => b.amount - a.amount)[0];
    
    if (!largestBorrow || !largestCollateral) throw new Error("Optimal liquidation not found");

    const amountToRepay = largestBorrow.amount; // Repay max available borrow
    const tokenMintToRepay = largestBorrow.bank.mint;

    return {
        repayBank: largestBorrow.bank,
        seizeBank: largestCollateral.bank,
        amountToRepay,
        tokenMintToRepay,
    };
}

async function getOrCreateAssociatedTokenAccount(connection, payer, mint, owner) {
    const associatedTokenAddress = await getAssociatedTokenAddress(mint, owner);

    try {
        await getAccount(connection, associatedTokenAddress);
        return { address: associatedTokenAddress };
    } catch (error) {
        if (error.name === 'TokenAccountNotFoundError' || error.name === 'TokenInvalidAccountOwnerError') {
            try {
                const transaction = new Transaction().add(
                    createAssociatedTokenAccountInstruction(
                        payer.publicKey,
                        associatedTokenAddress,
                        owner,
                        mint
                    )
                );
                const signature = await connection.sendTransaction(transaction, [payer]);
                await connection.confirmTransaction(signature, 'confirmed');
                return { address: associatedTokenAddress };
            } catch (createError) {
                console.error('Failed to create associated token account:', createError);
                return null;
            }
        } else {
            console.error('Failed to get associated token account:', error);
            return null;
        }
    }
}


// === Express Server ===
app.get('/', (req, res) => {
    res.send('✅ Solana Lending Liquidation Tracker is running...');
});

app.listen(PORT, async () => {
    console.log(`🌐 Server listening on port ${PORT}`);
    sendTelegramAlert('✅ Solana Lending Liquidation Tracker started and Telegram alerts are active!');
    await connectToSolana();
});
