const { ethers } = require('ethers');
const config = require('./config');

/**
 * Test if our swap encoding actually works with the DEX routers
 */

const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] routes) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) external returns (uint256[])'
];

const UNISWAP_QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
];

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('🧪 TESTING SWAP ROUTE ENCODING');
  console.log('='.repeat(70) + '\n');

  const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL, config.CHAIN_ID);
  
  const aerodromeRouter = new ethers.Contract(
    config.contracts.aerodromeRouter,
    AERODROME_ROUTER_ABI,
    provider
  );

  const uniswapQuoter = new ethers.Contract(
    config.contracts.uniswapQuoterV2,
    UNISWAP_QUOTER_ABI,
    provider
  );

  // Test Case 1: Simple WETH -> USDC swap
  console.log('TEST 1: WETH → USDC');
  console.log('─'.repeat(70));

  const WETH = config.tokens.WETH;
  const USDC = config.tokens.USDC;
  const testAmount = ethers.parseEther('0.1'); // 0.1 WETH

  // Test Uniswap Quote
  console.log('\n🦄 Testing Uniswap Quote...');
  try {
    const uniParams = {
      tokenIn: WETH.address,
      tokenOut: USDC.address,
      fee: 3000,
      amountIn: testAmount,
      sqrtPriceLimitX96: 0
    };

    const uniResult = await uniswapQuoter.quoteExactInputSingle.staticCall(uniParams);
    const uniOut = ethers.formatUnits(uniResult[0], USDC.decimals);
    console.log(`✅ Uniswap: 0.1 WETH → ${uniOut} USDC`);
  } catch (error) {
    console.log(`❌ Uniswap quote failed: ${error.message}`);
  }

  // Test Aerodrome Quote
  console.log('\n🛸 Testing Aerodrome Quote...');
  try {
    const aeroRoutes = [{
      from: WETH.address,
      to: USDC.address,
      stable: false,
      factory: config.contracts.aerodromeFactory
    }];

    const aeroResult = await aerodromeRouter.getAmountsOut(testAmount, aeroRoutes);
    const aeroOut = ethers.formatUnits(aeroResult[1], USDC.decimals);
    console.log(`✅ Aerodrome: 0.1 WETH → ${aeroOut} USDC`);
  } catch (error) {
    console.log(`❌ Aerodrome quote failed: ${error.message}`);
    console.log('\n⚠️  CRITICAL: This might be why transactions are failing!');
    console.log('   The Aerodrome route encoding might be wrong.');
  }

  // Test Case 2: Reverse - USDC -> WETH
  console.log('\n\nTEST 2: USDC → WETH');
  console.log('─'.repeat(70));

  const testAmountUSDC = ethers.parseUnits('300', USDC.decimals); // $300 USDC

  console.log('\n🛸 Testing Aerodrome reverse route...');
  try {
    const aeroRoutesReverse = [{
      from: USDC.address,
      to: WETH.address,
      stable: false,
      factory: config.contracts.aerodromeFactory
    }];

    const aeroResultReverse = await aerodromeRouter.getAmountsOut(testAmountUSDC, aeroRoutesReverse);
    const aeroOutReverse = ethers.formatUnits(aeroResultReverse[1], WETH.decimals);
    console.log(`✅ Aerodrome: 300 USDC → ${aeroOutReverse} WETH`);
  } catch (error) {
    console.log(`❌ Aerodrome reverse failed: ${error.message}`);
  }

  // Test Case 3: Try with stable=true
  console.log('\n\nTEST 3: Testing stable pools...');
  console.log('─'.repeat(70));

  console.log('\n🛸 Testing USDC/USDbC with stable=true...');
  try {
    const stableRoutes = [{
      from: config.tokens.USDC.address,
      to: config.tokens.USDbC.address,
      stable: true, // Try stable pool
      factory: config.contracts.aerodromeFactory
    }];

    const testUSDC = ethers.parseUnits('1000', 6);
    const stableResult = await aerodromeRouter.getAmountsOut(testUSDC, stableRoutes);
    const stableOut = ethers.formatUnits(stableResult[1], 6);
    console.log(`✅ Aerodrome (stable): 1000 USDC → ${stableOut} USDbC`);
  } catch (error) {
    console.log(`⚠️  Stable pool test failed (this is OK if no stable pool exists)`);
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 DIAGNOSIS');
  console.log('='.repeat(70));
  console.log('\nIf Aerodrome quotes are failing:');
  console.log('1. The factory address might be wrong');
  console.log('2. The pools might use different parameters');
  console.log('3. We might need to use stable=true for some pairs');
  console.log('\nIf quotes work but transactions fail:');
  console.log('1. Contract might not have token approvals');
  console.log('2. Aave flashloan might be the issue');
  console.log('3. Gas estimation might be wrong');
  console.log('\n' + '='.repeat(70) + '\n');
}

main().catch(console.error);
