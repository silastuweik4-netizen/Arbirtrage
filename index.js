import 'dotenv/config';
import express from 'express';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { PriceServiceConnection } from '@pythnetwork/hermes-client';
import { SolendMarket } from '@solendprotocol/solend-sdk';
import { KaminoMarket } from '@kamino-finance/klend-sdk';
import { MarginfiClient, getConfig } from '@mrgnlabs/marginfi-client-v2';
import { NodeWallet } from '@mrgnlabs/mrgn-common';
import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { BN } from 'bn.js';
import fetch from 'node-fetch';
import marginfiIdl from './marginfi-v2.json';
import kaminoIdl from './klend.json';

const app = express();
const PORT = process.env.PORT || 10000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RPC_URL_HTTP = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const RPC_URL_WS = process.env.WS_URL || 'wss://api.mainnet-beta.solana.com';
const PYTH_PRICE_SERVICE_URL = 'https://hermes.pyth.network/';

const pythConnection = new PriceServiceConnection(PYTH_PRICE_SERVICE_URL, { logger: console });

const LIQUIDATION_THRESHOLD_HEALTH_PERCENT = 105;

const LENDING_PROGRAM_IDS = [
  new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo'), // Solend
  new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmj6'), // Kamino
  new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA'), // Marginfi
];

const PROTOCOL_NAMES = new Map([
  ['So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', 'Solend'],
  ['KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmj6', 'Kamino'],
  ['MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', 'Marginfi'],
]);

const OBLIGATION_ACCOUNT_SIZES = new Map([
  ['So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', 1300],
  ['KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmj6', 2000],
  ['MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', 3928],
]);

const PROTOCOL_CLIENTS = new Map();
const activeObligationSubscriptions = new Map();

let connection;
let logSubscriptionId;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
  process.exit(1);
}

async function sendTelegramAlert(text) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' }),
    });
    if (!res.ok) throw new Error(await res.text());
    console.log('✅ Telegram alert sent');
  } catch (e) {
    console.error('❌ Telegram error:', e.message);
  }
}

async function initializeClients(connection) {
  const solendMarket = await SolendMarket.initialize(connection, 'mainnet-beta');
  PROTOCOL_CLIENTS.set(LENDING_PROGRAM_IDS[0].toBase58(), solendMarket);

  const kaminoMarket = await KaminoMarket.load(connection, new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF'));
  PROTOCOL_CLIENTS.set(LENDING_PROGRAM_IDS[1].toBase58(), kaminoMarket);

  const wallet = new NodeWallet(Keypair.generate());
  const config = getConfig('production');
  const marginfiClient = await MarginfiClient.fetch(config, wallet, connection);
  PROTOCOL_CLIENTS.set(LENDING_PROGRAM_IDS[2].toBase58(), marginfiClient);
}

function getSolendHealth(ob) {
  if (!ob?.stats?.collateralRatio) return '999.99';
  return (ob.stats.collateralRatio * 100).toFixed(2);
}

function getKaminoHealth(ob) {
  if (!ob) return '999.99';
  const { borrowLimit, liquidationThreshold } = ob.getBorrowLimitAndThreshold();
  if (borrowLimit.isZero()) return '999.99';
  return liquidationThreshold.muln(100).div(borrowLimit).toNumber() / 100;
}

function getMarginfiHealth(acc) {
  const { liabilities } = acc.getAssetsAndLiabilities();
  if (liabilities.isZero()) return '999.99';
  const { healthFactor, liquidationThreshold } = acc.getHealth();
  return healthFactor.muln(100).div(liquidationThreshold).toNumber() / 100;
}

async function connectToSolana() {
  console.log('🔌 Connecting to Solana...');
  connection = new Connection(RPC_URL_HTTP, { wsEndpoint: RPC_URL_WS });

  try {
    await initializeClients(connection);
    logSubscriptionId = connection.onLogs(
      { mentions: LENDING_PROGRAM_IDS },
      (logResult) => handleLogMessage(logResult).catch(console.error),
      'confirmed'
    );
    console.log('✅ Log subscription active, id:', logSubscriptionId);
    await discoverAndSubscribeObligations();
  } catch (e) {
    console.error('❌ Failed to connect to Solana or initialize clients:', e);
    process.exit(1);
  }
}

async function discoverAndSubscribeObligations() {
  for (const programId of LENDING_PROGRAM_IDS) {
    const idStr = programId.toBase58();
    const size = OBLIGATION_ACCOUNT_SIZES.get(idStr);
    
    if (!size) {
        console.error(`❌ Unknown obligation size for program: ${idStr}`);
        continue;
    }

    try {
      const accounts = await connection.getProgramAccounts(programId, {
        filters: [{ dataSize: size }],
      });
      console.log(`✅ ${PROTOCOL_NAMES.get(idStr)}: ${accounts.length} obligations discovered`);

      for (const { pubkey } of accounts) {
        const pkStr = pubkey.toBase58();
        if (!activeObligationSubscriptions.has(pkStr)) {
          const subscriptionId = connection.onAccountChange(
            pubkey,
            (accountInfo) => {
              handleObligationUpdate(pubkey, accountInfo).catch(console.error);
            },
            'confirmed'
          );
          activeObligationSubscriptions.set(pkStr, subscriptionId);
        }
      }
    } catch (e) {
      console.error(`❌ Failed to discover obligations for ${PROTOCOL_NAMES.get(idStr)}:`, e);
    }
  }
}


async function handleLogMessage(logResult) {
  const { logs, err, signature } = logResult;
  if (err) {
    console.warn(`⚠️ Transaction error in log subscription: ${err}`);
    return;
  }
  
  // Find transactions mentioning any of the lending programs
  const programMentioned = logResult.mentions.find(pk => LENDING_PROGRAM_IDS.some(id => id.equals(pk)));
  if (!programMentioned) return;

  const transaction = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
  if (!transaction) return;
  
  const { instructions } = transaction.transaction.message;
  // Use instruction data to potentially find the specific obligation account updated, 
  // though `onAccountChange` is the more reliable method for monitoring state.
}


async function handleObligationUpdate(pubkey, accountInfo) {
  try {
    const programIdStr = accountInfo.owner.toBase58();
    const client = PROTOCOL_CLIENTS.get(programIdStr);
    if (!client) return;

    let healthFactor;
    let decodedAccount;

    switch (programIdStr) {
      case LENDING_PROGRAM_IDS[0].toBase58(): // Solend
        // Solend's SDK handles decoding and health checks
        const solendMarket = client;
        const obligation = solendMarket.fetchObligation(pubkey);
        if (obligation) {
          healthFactor = getSolendHealth(obligation);
        }
        break;
      case LENDING_PROGRAM_IDS[1].toBase58(): // Kamino
        // Kamino's SDK for decoding
        const kaminoMarket = client;
        const obligationKamino = kaminoMarket.getObligationByAddress(pubkey);
        if (obligationKamino) {
          healthFactor = getKaminoHealth(obligationKamino);
        }
        break;
      case LENDING_PROGRAM_IDS[2].toBase58(): // Marginfi
        // Anchor coder for Marginfi
        const coder = new BorshAccountsCoder(marginfiIdl);
        decodedAccount = coder.decode('MarginfiAccount', accountInfo.data);
        const marginfiAccount = new (MarginfiAccount.getAccountClass(programIdStr))(
          pubkey,
          decodedAccount,
          client
        );
        healthFactor = getMarginfiHealth(marginfiAccount);
        break;
      default:
        console.warn(`Unknown protocol for obligation update: ${programIdStr}`);
        return;
    }

    if (healthFactor && healthFactor <= LIQUIDATION_THRESHOLD_HEALTH_PERCENT) {
      const alertMessage = `🚨 *Liquidation Alert!* 🚨\n\n` +
        `Protocol: ${PROTOCOL_NAMES.get(programIdStr)}\n` +
        `Obligation: \`${pubkey.toBase58()}\`\n` +
        `Health Factor: ${healthFactor}%\n` +
        `_Immediate action may be required._`;
      await sendTelegramAlert(alertMessage);
    }

  } catch (e) {
    console.error('❌ Error handling obligation update:', e);
  }
}

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await connectToSolana();
});
