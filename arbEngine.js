import fetch from 'node-fetch';
import { keypair, conn, getTokenBalance } from './wallet.js';

const JUP_API = 'https://quote-api.jup.ag/v7';

let tokenCache = [];
export async function updateTokenCache() {
  try {
    const res = await fetch(`${JUP_API}/tokens`);
    tokenCache = await res.json();
  } catch (e) {
    console.log('[CACHE] token update failed', e.message);
  }
}

export function getTokenBySymbol(symbol) {
  return tokenCache.find(t => t.symbol === symbol);
}

// Atomic profit simulation
export async function simulateArb(inputMint, outputMint, amount) {
  try {
    const body = {
      inputMint,
      outputMint,
      amount,
      slippageBps: 50,
      onlyDirectRoutes: false
    };
    const res = await fetch(`${JUP_API}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.routePlan || data.routePlan.length === 0) return null;

    // Calculate safe output (minimum liquidity in route)
    const minHop = Math.min(...data.routePlan.map(h => h.swapInfo.liquidityAvailable));
    const safeAmount = Math.floor(minHop / 3);

    return { routePlan: data.routePlan, safeAmount, inputMint, outputMint };
  } catch (e) {
    console.log('Simulation failed', e.message);
    return null;
  }
}
