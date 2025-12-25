import { simulateArb } from './arbEngine.js';
import { notify } from './telegram.js';

const MIN_PROFIT_USD = 10; // Only alert for >$10

export async function runPairWorker(pair) {
  const { inputMint, outputMint, loanAmount } = pair;

  try {
    const sim = await simulateArb(inputMint, outputMint, loanAmount);
    if (!sim) return;

    // Rough USD estimate (for demo purposes, replace with real oracle)
    const profitUSD = sim.safeAmount / 1e6; 
    if (profitUSD < MIN_PROFIT_USD) return;

    const msg = `<b>[SIMULATION] Arb opportunity detected!</b>\n` +
                `Base: ${inputMint}\n` +
                `Quote: ${outputMint}\n` +
                `Safe Amount: ${sim.safeAmount / 1e6} tokens\n` +
                `Estimated Profit ≈ $${profitUSD.toFixed(2)}`;
    console.log(msg);
    await notify(msg);
  } catch (e) {
    console.log('Worker error', e.message);
  }
}
