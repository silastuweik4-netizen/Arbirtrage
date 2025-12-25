import { updateTokenCache } from './arbEngine.js';
import { runPairWorker } from './worker.js';

const PAIRS = [
  { inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', outputMint: 'So11111111111111111111111111111111111111112', loanAmount: 1_000_000_000 },
  { inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', outputMint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', loanAmount: 500_000_000 },
  // Add more high-volume pairs here
];

async function main() {
  await updateTokenCache();
  setInterval(updateTokenCache, 60_000); // refresh cache every 60s

  setInterval(async () => {
    for (const pair of PAIRS) {
      runPairWorker(pair); // staggered async
      await new Promise(r => setTimeout(r, 300)); // small delay per worker
    }
  }, 2_000); // full cycle every 2s
}

main().catch(console.error);
