import 'dotenv/config';
import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';

// Import modular components
import { sendTelegramAlert } from './notifications/telegram.js';
import { SolendProtocol } from './protocols/solend.js';
import { KaminoProtocol } from './protocols/kamino.js';
import { MarginfiProtocol } from './protocols/marginfi.js';

// Environment variables
const RPC_URL_HTTP = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const RPC_URL_WS = process.env.WS_URL || 'wss://api.mainnet-beta.solana.com';
const LIQUIDATION_THRESHOLD_HEALTH_PERCENT = parseInt(process.env.LIQUIDATION_THRESHOLD_HEALTH_PERCENT || '105', 10);

// List of protocols to monitor
const PROTOCOLS = [
  new SolendProtocol(),
  new KaminoProtocol(),
  new MarginfiProtocol(),
];

let connection: Connection;
const activeObligationSubscriptions = new Map(); // Tracks active WebSocket subscriptions

// --- Main Connection and Monitoring Logic ---

/**
 * Initializes the Solana connection and all protocol clients.
 */
async function initialize() {
  console.log('🔌 Connecting to Solana...');
  connection = new Connection(RPC_URL_HTTP, { wsEndpoint: RPC_URL_WS, commitment: 'confirmed' });

  try {
    // Test connection
    await connection.getEpochInfo();
    console.log('✅ Connected to Solana successfully.');

    // Initialize each protocol client and its necessary data
    for (const protocol of PROTOCOLS) {
      console.log(`⏳ Initializing ${protocol.name} protocol...`);
      await protocol.initialize(connection);
      console.log(`✅ ${protocol.name} client initialized.`);
    }

    // Discover existing obligations and subscribe to their account changes
    await discoverAndSubscribe();

  } catch (e: any) {
    console.error('❌ Failed to connect to Solana or initialize protocols:', e.message);
    process.exit(1);
  }
}

/**
 * Discovers existing obligations for all protocols and sets up real-time subscriptions.
 */
async function discoverAndSubscribe() {
  console.log('⏳ Discovering existing obligations...');
  for (const protocol of PROTOCOLS) {
    try {
      // Get all known obligation accounts for this protocol
      const obligations = await protocol.getObligationAccounts(connection);
      console.log(`✅ ${protocol.name}: Found ${obligations.length} existing obligations.`);

      for (const { pubkey, programId } of obligations) {
        const pkStr = pubkey.toBase58();
        // Only subscribe if not already tracking this obligation
        if (!activeObligationSubscriptions.has(pkStr)) {
          // Subscribe to real-time updates for each obligation account
          const subscriptionId = connection.onAccountChange(
            pubkey,
            (accountInfo) => {
              // Pass the specific protocol and obligation pubkey to the handler
              handleObligationUpdate(protocol, pubkey, programId, accountInfo).catch(console.error);
            },
            'confirmed' // Use 'confirmed' to ensure data is stable
          );
          activeObligationSubscriptions.set(pkStr, subscriptionId);
        }
      }
    } catch (e: any) {
      console.error(`❌ Failed to discover obligations for ${protocol.name}:`, e.message);
    }
  }
  console.log(`✅ Monitoring ${activeObligationSubscriptions.size} obligation accounts.`);
}

/**
 * Handles an update to an obligation account, calculates its health, and sends an alert if necessary.
 * @param protocol The protocol handler for the updated account.
 * @param pubkey The public key of the updated obligation account.
 * @param programId The program ID of the lending protocol.
 * @param accountInfo The updated account data.
 */
async function handleObligationUpdate(protocol: any, pubkey: PublicKey, programId: PublicKey, accountInfo: AccountInfo<Buffer>) {
  try {
    const healthFactor = await protocol.getHealthFactor(pubkey, accountInfo);

    if (healthFactor !== null && healthFactor <= LIQUIDATION_THRESHOLD_HEALTH_PERCENT) {
      const alertMessage = `🚨 *Liquidation Alert!* 🚨\n\n` +
        `Protocol: ${protocol.name}\n` +
        `Obligation: \`${pubkey.toBase58()}\`\n` +
        `Health Factor: *${healthFactor.toFixed(2)}%* (Threshold: ${LIQUIDATION_THRESHOLD_HEALTH_PERCENT}%)\n` +
        `_Immediate action may be required._`;
      console.log(alertMessage); // Log the alert
      await sendTelegramAlert(alertMessage);
    }

  } catch (e: any) {
    console.error(`❌ Error handling obligation update for ${protocol.name} obligation ${pubkey.toBase58()}:`, e.message);
  }
}

// --- Main execution ---
initialize().catch(console.error);

// --- Graceful Shutdown ---
process.on('SIGINT', async () => {
  console.log(' shutting down...');
  for (const [pkStr, subId] of activeObligationSubscriptions.entries()) {
    await connection.removeAccountChangeListener(subId);
  }
  console.log('All subscriptions removed. Exiting.');
  process.exit(0);
});
