import 'dotenv/config';
import { Connection, Keypair } from '@solana/web3.js';
import { monitorObligations } from './monitor.js';
import { simulateProfit } from './simulate.js';
import { liquidate } from './liquidate.js';

const connection = new Connection(process.env.RPC_ENDPOINT, 'confirmed');
const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(process.env.WALLET_SECRET))
);

async function main() {
  console.log("Starting liquidation bot...");

  // Step 1: Monitor obligations
  const candidates = await monitorObligations(connection);

  for (const c of candidates) {
    // Step 2: Simulate profitability
    const profit = await simulateProfit(c);
    if (profit > 0) {
      console.log(`Profitable liquidation found: ${profit} USDC`);
      // Step 3: Execute liquidation
      await liquidate(connection, wallet, c);
    }
  }
}

main().catch(console.error);
