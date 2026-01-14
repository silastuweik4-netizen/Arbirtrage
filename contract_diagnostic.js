const { ethers } = require('ethers');
const config = require('./config');

/**
 * This script tests why the arbitrage contract is failing
 * Run: node test-contract.js
 */

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

const AAVE_POOL_ABI = [
  'function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
  'function flashLoan(address receiverAddress, address[] assets, uint256[] amounts, uint256[] modes, address onBehalfOf, bytes params, uint16 referralCode) external'
];

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('🔍 ARBITRAGE CONTRACT DIAGNOSTIC');
  console.log('='.repeat(70) + '\n');

  const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL, config.CHAIN_ID);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || config.PRIVATE_KEY, provider);

  console.log('📍 Your Address:', wallet.address);
  console.log('📍 Contract Address:', config.contracts.arbitrageContract);
  console.log('');

  // Test 1: Check Aave Pool
  console.log('═'.repeat(70));
  console.log('TEST 1: Aave V3 Pool on Base');
  console.log('═'.repeat(70));

  const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
  console.log('Aave Pool:', AAVE_POOL);

  try {
    const aavePool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, provider);
    
    // Check if WETH is supported
    const wethAddress = config.tokens.WETH.address;
    console.log('\nChecking WETH reserve data...');
    const reserveData = await aavePool.getReserveData(wethAddress);
    
    console.log('✅ WETH is supported in Aave V3');
    console.log('   aToken:', reserveData.aTokenAddress);
    console.log('   Liquidity Rate:', ethers.formatUnits(reserveData.currentLiquidityRate, 27), '%');
    
    // Check USDC
    const usdcAddress = config.tokens.USDC.address;
    console.log('\nChecking USDC reserve data...');
    const usdcReserve = await aavePool.getReserveData(usdcAddress);
    console.log('✅ USDC is supported in Aave V3');
    console.log('   aToken:', usdcReserve.aTokenAddress);
    
  } catch (error) {
    console.log('❌ ERROR:', error.message);
    console.log('\n⚠️  CRITICAL: Aave pool might not be working correctly on Base');
  }

  // Test 2: Check Contract Deployment
  console.log('\n' + '═'.repeat(70));
  console.log('TEST 2: Contract Deployment');
  console.log('═'.repeat(70));

  const contractCode = await provider.getCode(config.contracts.arbitrageContract);
  if (contractCode === '0x') {
    console.log('❌ CRITICAL: Contract not deployed!');
    return;
  }
  console.log('✅ Contract is deployed');
  console.log('   Bytecode length:', contractCode.length, 'characters');

  // Test 3: Check Contract Owner
  console.log('\n' + '═'.repeat(70));
  console.log('TEST 3: Contract Ownership');
  console.log('═'.repeat(70));

  try {
    const contract = new ethers.Contract(
      config.contracts.arbitrageContract,
      ['function owner() view returns (address)'],
      provider
    );
    
    const owner = await contract.owner();
    console.log('Contract Owner:', owner);
    console.log('Your Address:', wallet.address);
    console.log(owner.toLowerCase() === wallet.address.toLowerCase() ? '✅ You are the owner' : '❌ You are NOT the owner');
  } catch (error) {
    console.log('⚠️  Could not check owner:', error.message);
  }

  // Test 4: Check Token Balances
  console.log('\n' + '═'.repeat(70));
  console.log('TEST 4: Token Availability');
  console.log('═'.repeat(70));

  for (const [symbol, tokenData] of Object.entries(config.tokens)) {
    try {
      const token = new ethers.Contract(tokenData.address, ERC20_ABI, provider);
      const [tokenSymbol, decimals] = await Promise.all([
        token.symbol(),
        token.decimals()
      ]);
      
      console.log(`✅ ${symbol.padEnd(10)} ${tokenData.address} (${tokenSymbol}, ${decimals} decimals)`);
    } catch (error) {
      console.log(`❌ ${symbol.padEnd(10)} ${tokenData.address} - ERROR: ${error.message}`);
    }
  }

  // Test 5: Check DEX Routers
  console.log('\n' + '═'.repeat(70));
  console.log('TEST 5: DEX Router Availability');
  console.log('═'.repeat(70));

  const routers = [
    { name: 'Uniswap Quoter', address: config.contracts.uniswapQuoterV2 },
    { name: 'Aerodrome Router', address: config.contracts.aerodromeRouter },
    { name: 'Aerodrome Factory', address: config.contracts.aerodromeFactory },
  ];

  for (const router of routers) {
    const code = await provider.getCode(router.address);
    if (code === '0x') {
      console.log(`❌ ${router.name}: NOT DEPLOYED`);
    } else {
      console.log(`✅ ${router.name}: Deployed`);
    }
  }

  // Test 6: Simulate a Small Flashloan (DRY RUN)
  console.log('\n' + '═'.repeat(70));
  console.log('TEST 6: Flashloan Simulation (Estimate Gas)');
  console.log('═'.repeat(70));

  try {
    const contract = new ethers.Contract(
      config.contracts.arbitrageContract,
      ['function initiateFlashloan(tuple(address tokenBorrow, uint256 amountBorrow, address tokenIn, address tokenOut, uint256 minAmountOut, bytes swapDataA, bytes swapDataB)) external'],
      wallet
    );

    // Create minimal test parameters
    const testParams = {
      tokenBorrow: config.tokens.WETH.address,
      amountBorrow: ethers.parseEther('0.001'), // Very small amount
      tokenIn: config.tokens.WETH.address,
      tokenOut: config.tokens.USDC.address,
      minAmountOut: 0,
      swapDataA: '0x', // Empty swap data
      swapDataB: '0x'
    };

    console.log('Attempting to estimate gas for flashloan...');
    console.log('Borrowing: 0.001 WETH');

    const gasEstimate = await contract.initiateFlashloan.estimateGas(testParams);
    console.log('✅ Gas estimate successful:', gasEstimate.toString());
    console.log('   This suggests the contract CAN execute flashloans');

  } catch (error) {
    console.log('❌ Gas estimation failed!');
    console.log('   Error:', error.message);
    
    if (error.message.includes('execution reverted')) {
      console.log('\n⚠️  CRITICAL FINDING:');
      console.log('   The contract reverts even before execution');
      console.log('   This means there\'s a problem in the contract logic');
      console.log('\n   Possible causes:');
      console.log('   1. Aave pool doesn\'t support these tokens');
      console.log('   2. Contract has insufficient approvals');
      console.log('   3. Swap routes are invalid');
      console.log('   4. Contract logic has a bug');
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('📊 DIAGNOSTIC SUMMARY');
  console.log('═'.repeat(70));
  console.log('\nNext Steps:');
  console.log('1. ✅ Update config.js with the emergency stop config');
  console.log('2. 📧 Check the error message from gas estimation above');
  console.log('3. 🔧 Based on the error, we can fix the contract issue');
  console.log('\n');
}

main().catch(console.error);
