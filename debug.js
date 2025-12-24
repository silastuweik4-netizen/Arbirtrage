import { config } from 'dotenv'; config();

const JUP_API = 'https://quote-api.jupiter.ag/v6';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';

async function debug() {
  try {
    // Test if Jupiter is responding
    const q1 = await fetch(`${JUP_API}/quote?inputMint=${USDC}&outputMint=${SOL}&amount=${1000e6}&slippageBps=50`);
    console.log('Jupiter API Status:', q1.status);
    
    // Test Kamino
    const kamino = await fetch('https://api.kamino.finance/v1/flash-loan/info/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    console.log('Kamino API Status:', kamino.status);
    
    // Test Jito
    const jito = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('Jito API Status:', jito.status);
    
  } catch (e) {
    console.log('Debug error:', e.message);
  }
}

debug();
