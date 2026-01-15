require('dotenv').config();
const ArbitrageScanner = require('./scanner');

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

async function runTests() {
  console.log('🧪 Starting Arbitrage Scanner Tests...\n');

  try {
    // Initialize scanner
    console.log('📍 Initializing Scanner...');
    const scanner = new ArbitrageScanner();
    await scanner.initialize();
    console.log('✅ Scanner initialized\n');

    // Test 1: Get token info
    console.log('📋 TEST 1: Fetching Token Information');
    console.log('─'.repeat(60));
    const wethInfo = await scanner.getTokenInfo(WETH);
    const usdcInfo = await scanner.getTokenInfo(USDC);
    console.log('WETH:', wethInfo);
    console.log('USDC:', usdcInfo);
    console.log();

    // Test 2: Get pair prices
    console.log('💹 TEST 2: Fetching Pair Prices');
    console.log('─'.repeat(60));
    const aeroPrice = await scanner.getPairPrice('aerodrome', WETH, USDC);
    const panPrice = await scanner.getPairPrice('pancakeswap', WETH, USDC);
    console.log('Aerodrome WETH/USDC:', aeroPrice);
    console.log('PancakeSwap WETH/USDC:', panPrice);
    console.log();

    // Test 3: Scan for arbitrage opportunities
    console.log('🔍 TEST 3: Scanning for Arbitrage Opportunities');
    console.log('─'.repeat(60));
    const opportunities = await scanner.scanForArbitrageOpportunities();
    console.log(`Found ${opportunities.length} opportunities:\n`);
    opportunities.slice(0, 5).forEach((opp, idx) => {
      console.log(`${idx + 1}. ${opp.token0.symbol}/${opp.token1.symbol}`);
      console.log(`   Aerodrome: ${opp.aerodromePrice}`);
      console.log(`   PancakeSwap: ${opp.pancakeswapPrice}`);
      console.log(`   Difference: ${opp.priceDiffPercent}%`);
      console.log(`   Buy on: ${opp.cheaperOn} | Sell on: ${opp.expensiveOn}`);
      console.log(`   Profit Potential: ${opp.profitPotential}%\n`);
    });

    // Test 4: Scan top pools
    console.log('🏊 TEST 4: Top Aerodrome Pools');
    console.log('─'.repeat(60));
    const topPools = await scanner.scanTopPools();
    console.log(`Found ${topPools.length} top pools:\n`);
    topPools.slice(0, 5).forEach((pool, idx) => {
      console.log(`${idx + 1}. ${pool.token0}/${pool.token1}`);
      console.log(`   Address: ${pool.pair}`);
      console.log();
    });

    console.log('✅ All tests completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

runTests();
