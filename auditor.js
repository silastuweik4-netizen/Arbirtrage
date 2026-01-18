const { ethers } = require('ethers');
require('dotenv').config();

const CONFIG = {
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  MIN_LIQUIDITY_THRESHOLD_USD: 5000, // Minimum liquidity in USD to consider a pool "active"
};

const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

const ERC20_ABI = ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'];
const UNISWAP_V3_FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const UNISWAP_V2_FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const AERODROME_FACTORY_ABI = ['function getPool(address,address,bool) view returns (address)'];

const FACTORIES = {
  UNISWAP_V3: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  UNISWAP_V2: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
  AERODROME: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
  PANCAKESWAP_V3: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'
};

const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  USDC: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 },
  USDT: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
  DAI: { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', decimals: 18 },
  cbBTC: { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', decimals: 8 },
  WBTC: { address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', decimals: 8 },
  AERO: { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', decimals: 18 },
  DEGEN: { address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', decimals: 18 },
  BRETT: { address: '0x532f27101965dd16442E59d40670FaF5eBB142E4', decimals: 18 },
  VIRTUAL: { address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', decimals: 18 },
  SOL: { address: '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82', decimals: 18 },
  wstETH: { address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452', decimals: 18 },
  weETH: { address: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a', decimals: 18 },
  USDS: { address: '0x820c137fa70c8691f0e44dc420a5e53c168921dc', decimals: 18 },
  USDe: { address: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34', decimals: 18 },
  sUSDS: { address: '0x5875eee11cf8398102fdad704c9e96607675467a', decimals: 18 },
  sUSDC: { address: '0x3128a0f7f0ea68e7b7c9b00afa7e41045828e858', decimals: 6 },
  sUSDe: { address: '0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2', decimals: 18 },
  DOT: { address: '0x8d010bf9c26881788b4e6bf5fd1bdc358c8f90b8', decimals: 18 },
  AAVE: { address: '0x63706e401c06ac8513145b7687a14804d17f814b', decimals: 18 },
  ENA: { address: '0x58538e6A46E07434d7E7375Bc268D3cb839C0133', decimals: 18 },
  rETH: { address: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c', decimals: 18 },
  syrupUSDC: { address: '0x660975730059246a68521a3e2fbd4740173100f5', decimals: 18 },
  TRUMP: { address: '0xc27468b12ffa6d714b1b5fbc87ef403f38b82ad4', decimals: 18 },
  LBTC: { address: '0xecac9c5f704e954931349da37f60e39f515c11c1', decimals: 8 },
  SolvBTC: { address: '0x3b86ad95859b6ab773f55f8d94b4b9d443ee931f', decimals: 18 },
  LsETH: { address: '0xb29749498954a3a821ec37bde86e386df3ce30b6', decimals: 18 },
  MORPHO: { address: '0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842', decimals: 18 },
  ezETH: { address: '0x2416092f143378750bb29b79ed961ab195cceea5', decimals: 18 },
  CRV: { address: '0x8Ee73c484A26e0A5df2Ee2a4960B789967dd0415', decimals: 18 },
  LINK: { address: '0x88Fb150BD486054367873f449caC4489Ba0E6569', decimals: 18 },
  LDO: { address: '0x76887793387768521a3e2fbd4740173100f5', decimals: 18 },
};

async function checkLiquidity(token0, token1) {
  const results = {};
  
  // Uniswap V3
  try {
    const factory = new ethers.Contract(FACTORIES.UNISWAP_V3, UNISWAP_V3_FACTORY_ABI, provider);
    const pool = await factory.getPool(token0.address, token1.address, 500); // Check 0.05% fee tier
    if (pool !== ethers.constants.AddressZero) {
      const t0 = new ethers.Contract(token0.address, ERC20_ABI, provider);
      const balance = await t0.balanceOf(pool);
      results.uniswap_v3 = parseFloat(ethers.utils.formatUnits(balance, token0.decimals));
    }
  } catch (e) {}

  // Uniswap V2
  try {
    const factory = new ethers.Contract(FACTORIES.UNISWAP_V2, UNISWAP_V2_FACTORY_ABI, provider);
    const pair = await factory.getPair(token0.address, token1.address);
    if (pair !== ethers.constants.AddressZero) {
      const t0 = new ethers.Contract(token0.address, ERC20_ABI, provider);
      const balance = await t0.balanceOf(pair);
      results.uniswap_v2 = parseFloat(ethers.utils.formatUnits(balance, token0.decimals));
    }
  } catch (e) {}

  // Aerodrome
  try {
    const factory = new ethers.Contract(FACTORIES.AERODROME, AERODROME_FACTORY_ABI, provider);
    const pool = await factory.getPool(token0.address, token1.address, false); // Volatile
    if (pool !== ethers.constants.AddressZero) {
      const t0 = new ethers.Contract(token0.address, ERC20_ABI, provider);
      const balance = await t0.balanceOf(pool);
      results.aerodrome = parseFloat(ethers.utils.formatUnits(balance, token0.decimals));
    }
  } catch (e) {}

  return results;
}

async function main() {
  console.log('Starting Liquidity Audit...');
  const tokenList = Object.keys(TOKENS);
  const pairs = [];
  
  // Generate same pairs as in detector.js
  const stablecoins = ['USDC', 'USDT', 'DAI'];
  const majorTokens = ['WETH', 'cbBTC', 'WBTC', 'AERO'];
  
  for (const tName of majorTokens) {
    for (const sName of stablecoins) {
      pairs.push({ t0: TOKENS[tName], t1: TOKENS[sName], name: `${tName}/${sName}` });
    }
  }
  
  const otherTokens = tokenList.filter(t => !majorTokens.includes(t) && !stablecoins.includes(t));
  for (const tName of otherTokens) {
    pairs.push({ t0: TOKENS[tName], t1: TOKENS.WETH, name: `${tName}/WETH` });
    pairs.push({ t0: TOKENS[tName], t1: TOKENS.USDC, name: `${tName}/USDC` });
  }

  console.log(`Auditing ${pairs.length} pairs...`);
  
  const auditReport = [];
  for (const pair of pairs) {
    process.stdout.write(`Checking ${pair.name}... `);
    const liquidity = await checkLiquidity(pair.t0, pair.t1);
    const activeDexes = Object.keys(liquidity);
    console.log(activeDexes.length >= 2 ? '✅' : '❌');
    auditReport.push({ name: pair.name, dexes: activeDexes, liquidity });
  }

  console.log('\n--- AUDIT SUMMARY ---');
  const validPairs = auditReport.filter(r => r.dexes.length >= 2);
  console.log(`Total Pairs: ${auditReport.length}`);
  console.log(`Actionable Pairs (Liquidity on 2+ DEXs): ${validPairs.length}`);
  
  validPairs.forEach(p => {
    console.log(`- ${p.name}: ${p.dexes.join(', ')}`);
  });
}

main();
