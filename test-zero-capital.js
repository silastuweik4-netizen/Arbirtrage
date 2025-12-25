//  test-zero-capital.js  — Test zero-capital system
import { getRenderSafePrices } from './render-safe-prices.js';

async function testZeroCapitalSystem() {
  console.log('🧪 Testing zero-capital system...');
  
  const prices = await getRenderSafePrices();
  
  if (prices) {
    console.log('✅ Render-safe APIs working:');
    console.log(`📊 Coingecko: $${prices.coingecko}`);
    console.log(`📊 Binance: $${prices.binance}`);
    console.log('✅ Zero-capital system ready!');
  } else {
    console.log('❌ Render-safe APIs failed');
  }
}

testZeroCapitalSystem();
