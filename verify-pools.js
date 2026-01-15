const { ethers } = require('ethers');
const config = require('./config');

/**
 * This script verifies that actual Uniswap V3 pools exist with real liquidity
 * for all the pairs we're trying to arbitrage
 */

const UNISWAP_V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD'; // Uniswap V3 Factory on Base
const AERODROME_FACTORY = '0x420dd381b31aef6683db6b902084cb0ffece40da'; // Aerodrome Factory

const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)'
];

const POOL_ABI = [
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];

const AERODROME_POOL_ABI = [
  'function getReserves() view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function stable() view returns (bool)'
];

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)'
];

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 VERIFYING POOL LIQUIDITY FOR ALL ARBITRAGE PAIRS');
  console.log('='.repeat(80) + '\n');

  const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL, config.CHAIN_ID);
  
  const uniswapFactory = new ethers.Contract(UNISWAP_V3_FACTORY, FACTORY_ABI, provider);
  const aerodromeFactory = new ethers.Contract(AERODROME_FACTORY, FACTORY_ABI, provider);

  const results = {
    validPairs: [],
    invalidPairs: [],
    warnings: []
  };

  console.log(`Checking ${config.pairs.length} pairs...\n`);

  for (const pair of config.pairs) {
    console.log('─'.repeat(80));
    console.log(`\n📊 PAIR: ${pair.name} (Fee: ${pair.fee/10000}%)`);
    console.log('─'.repeat(80));

    const token0 = config.tokens[pair.token0];
    const token1 = config.tokens[pair.token1];

    if (!token0 || !token1) {
      console.log(`❌ ERROR: Token not found in config (${pair.token0} or ${pair.token1})`);
      results.invalidPairs.push({ pair: pair.name, reason: 'Token not in config' });
      continue;
    }

    console.log(`Token 0: ${pair.token0} (${token0.address})`);
    console.log(`Token 1: ${pair.token1} (${token1.address})`);

    // Check Uniswap V3 Pool
    console.log('\n🦄 Checking Uniswap V3 Pool...');
    try {
      const uniPoolAddress = await uniswapFactory.getPool(
        token0.address,
        token1.address,
        pair.fee
      );

      if (uniPoolAddress === ethers.ZeroAddress) {
        console.log('❌ Uniswap pool does NOT exist');
        results.invalidPairs.push({ pair: pair.name, reason: 'No Uniswap pool' });
        continue;
      }

      console.log(`✅ Pool exists: ${uniPoolAddress}`);

      // Check liquidity
      const uniPool = new ethers.Contract(uniPoolAddress, POOL_ABI, provider);
      const liquidity = await uniPool.liquidity();
      const slot0 = await uniPool.slot0();

      console.log(`   Liquidity: ${liquidity.toString()}`);
      console.log(`   Current Price (sqrtPriceX96): ${slot0.sqrtPriceX96.toString()}`);

      if (liquidity === 0n) {
        console.log('⚠️  WARNING: Pool has ZERO liquidity!');
        results.warnings.push({ pair: pair.name, issue: 'Zero Uniswap liquidity' });
        continue;
      }

      // Get actual token balances in pool
      const token0Contract = new ethers.Contract(token0.address, ERC20_ABI, provider);
      const token1Contract = new ethers.Contract(token1.address, ERC20_ABI, provider);

      const balance0 = await token0Contract.balanceOf(uniPoolAddress);
      const balance1 = await token1Contract.balanceOf(uniPoolAddress);

      const amount0 = ethers.formatUnits(balance0, token0.decimals);
      const amount1 = ethers.formatUnits(balance1, token1.decimals);

      console.log(`   ${pair.token0} in pool: ${parseFloat(amount0).toFixed(4)}`);
      console.log(`   ${pair.token1} in pool: ${parseFloat(amount1).toFixed(4)}`);

      const hasLiquidity = parseFloat(amount0) > 0.001 && parseFloat(amount1) > 0.001;
      
      if (!hasLiquidity) {
        console.log('⚠️  WARNING: Very low liquidity - trades may fail');
        results.warnings.push({ pair: pair.name, issue: 'Very low liquidity' });
      }

    } catch (error) {
      console.log(`❌ Error checking Uniswap: ${error.message}`);
      results.invalidPairs.push({ pair: pair.name, reason: `Uniswap error: ${error.message}` });
      continue;
    }

    // Check Aerodrome Pool
    console.log('\n🛸 Checking Aerodrome Pool...');
    try {
      // Aerodrome uses same factory interface as Uniswap
      // Try to get pool (Aerodrome usually uses 0 for fee on their AMM)
      let aeroPoolAddress = await aerodromeFactory.getPool(
        token0.address,
        token1.address,
        0 // Aerodrome typically uses 0 fee for their pools
      );

      if (aeroPoolAddress === ethers.ZeroAddress) {
        console.log('⚠️  Aerodrome pool does NOT exist');
        console.log('   (This pair may only work on Uniswap)');
        results.warnings.push({ pair: pair.name, issue: 'No Aerodrome pool' });
        
        // Mark as valid if Uniswap pool exists
        results.validPairs.push({
          pair: pair.name,
          uniswap: 'Yes',
          aerodrome: 'No',
          note: 'Can only arbitrage between Uniswap pools with different fees'
        });
        continue;
      }

      console.log(`✅ Pool exists: ${aeroPoolAddress}`);

      // Check Aerodrome liquidity
      const aeroPool = new ethers.Contract(aeroPoolAddress, AERODROME_POOL_ABI, provider);
      const reserves = await aeroPool.getReserves();

      const reserve0 = ethers.formatUnits(reserves.reserve0, token0.decimals);
      const reserve1 = ethers.formatUnits(reserves.reserve1, token1.decimals);

      console.log(`   ${pair.token0} reserve: ${parseFloat(reserve0).toFixed(4)}`);
      console.log(`   ${pair.token1} reserve: ${parseFloat(reserve1).toFixed(4)}`);

      const hasAeroLiquidity = parseFloat(reserve0) > 0.001 && parseFloat(reserve1) > 0.001;

      if (!hasAeroLiquidity) {
        console.log('⚠️  WARNING: Very low Aerodrome liquidity');
        results.warnings.push({ pair: pair.name, issue: 'Low Aerodrome liquidity' });
      }

      // Both pools exist with liquidity
      results.validPairs.push({
        pair: pair.name,
        uniswap: 'Yes',
        aerodrome: 'Yes',
        note: 'Ready for arbitrage'
      });

    } catch (error) {
      console.log(`⚠️  Could not check Aerodrome: ${error.message}`);
      results.validPairs.push({
        pair: pair.name,
        uniswap: 'Yes',
        aerodrome: 'Unknown',
        note: 'Error checking Aerodrome, but Uniswap pool exists'
      });
    }

    console.log('');
  }

  // Print Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 LIQUIDITY CHECK SUMMARY');
  console.log('='.repeat(80));

  console.log(`\n✅ Valid Pairs (${results.validPairs.length}):`);
  if (results.validPairs.length === 0) {
    console.log('   None - This is a CRITICAL problem!');
  } else {
    results.validPairs.forEach(item => {
      console.log(`   ${item.pair.padEnd(20)} Uni: ${item.uniswap}  Aero: ${item.aerodrome}  ${item.note}`);
    });
  }

  console.log(`\n❌ Invalid Pairs (${results.invalidPairs.length}):`);
  if (results.invalidPairs.length > 0) {
    results.invalidPairs.forEach(item => {
      console.log(`   ${item.pair.padEnd(20)} Reason: ${item.reason}`);
    });
  } else {
    console.log('   None');
  }

  console.log(`\n⚠️  Warnings (${results.warnings.length}):`);
  if (results.warnings.length > 0) {
    results.warnings.forEach(item => {
      console.log(`   ${item.pair.padEnd(20)} Issue: ${item.issue}`);
    });
  } else {
    console.log('   None');
  }

  // Recommendations
  console.log('\n' + '='.repeat(80));
  console.log('💡 RECOMMENDATIONS');
  console.log('='.repeat(80));

  if (results.invalidPairs.length > 0) {
    console.log('\n❌ REMOVE these pairs from config.js:');
    results.invalidPairs.forEach(item => {
      console.log(`   - ${item.pair}`);
    });
  }

  if (results.warnings.length > 0) {
    console.log('\n⚠️  CONSIDER REMOVING pairs with low liquidity:');
    results.warnings.forEach(item => {
      if (item.issue.includes('liquidity')) {
        console.log(`   - ${item.pair} (${item.issue})`);
      }
    });
  }

  if (results.validPairs.length > 0) {
    console.log('\n✅ KEEP these pairs in config.js:');
    results.validPairs.forEach(item => {
      console.log(`   - ${item.pair}`);
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('');

  // Save results to file
  const fs = require('fs');
  fs.writeFileSync('pool-verification-results.json', JSON.stringify(results, null, 2));
  console.log('💾 Results saved to pool-verification-results.json\n');
}

main().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
