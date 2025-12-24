//  network-test.js  — test what Render allows
const fetch = require('node-fetch');

async function testNetworks() {
  const tests = [
    { name: 'Google', url: 'https://www.google.com' },
    { name: 'CoinGecko', url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd' },
    { name: 'Jupiter', url: 'https://quote-api.jup.ag/v6/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000' },
    { name: 'Solana RPC', url: 'https://api.mainnet-beta.solana.com', method: 'POST', body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getHealth'}) },
    { name: 'Kamino', url: 'https://api.kamino.finance/v1/flash-loan/info/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
  ];

  for (const test of tests) {
    try {
      console.log(`\n🧪 Testing ${test.name}...`);
      const options = test.method === 'POST' ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: test.body
      } : {};
      
      const response = await fetch(test.url, options);
      console.log(`${test.name}: ✅ ${response.status}`);
      
    } catch (error) {
      console.log(`${test.name}: ❌ ${error.message}`);
    }
  }
}

testNetworks().then(() => {
  console.log('\n🔍 Network test complete!');
});
