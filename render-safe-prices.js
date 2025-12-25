//  render-safe-prices.js  — FIXED export name
const WORKING_ENDPOINTS = {
  coingecko: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
  binance: 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
  solanaRPC: 'https://api.mainnet-beta.solana.com',
  raydium: 'https://api.raydium.io/v2/main/pairs'
};

export async function getRenderSafePrices() {  // FIXED: changed from RenderSafePrices to getRenderSafePrices
  try {
    // Use working APIs (confirmed safe in Render)
    const [coingecko, binance] = await Promise.all([
      fetch(WORKING_ENDPOINTS.coingecko),
      fetch(WORKING_ENDPOINTS.binance)
    ]);
    
    if (coingecko.ok && binance.ok) {
      const [coingeckoData, binanceData] = await Promise.all([
        coingecko.json(),
        binance.json()
      ]);
      
      return {
        coingecko: coingeckoData.solana.usd,
        binance: parseFloat(binanceData.price),
        timestamp: new Date().toISOString()
      };
    }
    
    return null;
    
  } catch (error) {
    console.log('Render-safe API failed:', error.message);
    return null;
  }
}
