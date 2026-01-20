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

const TOKEN_PRICES_USD = {
  WETH: 2500, USDC: 1, USDT: 1, DAI: 1,
  cbBTC: 43000, WBTC: 43000, LBTC: 43000,
  AERO: 0.8, DEGEN: 0.05, BRETT: 0.35, VIRTUAL: 5,
  SOL: 200, wstETH: 3200, weETH: 3200,
  USDS: 1, USDe: 1, sUSDS: 1, sUSDC: 1, sUSDe: 1,
  DOT: 8, AAVE: 320, ENA: 1, rETH: 3200,
  syrupUSDC: 1, TRUMP: 30, SolvBTC: 43000,
  LsETH: 3200, MORPHO: 2, ezETH: 3200,
  CRV: 0.3, LINK: 22, LDO: 3
};

const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  USDC: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 },
  USDT: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
  DAI: { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', decimals: 18 },
  cbBTC: { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', decimals: 8 },
  WBTC: { address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', decimals: 8 },
  LBTC: { address: '0xecac9c5f704e954931349da37f60e39f515c11c1', decimals: 8 },
  AERO: { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', decimals: 18 },
  // ... other tokens unchanged
};

async function checkLiquidity(token0, token1) {
  const results = {};

  // Uniswap V3 — hardened fee tiers
  try {
    const factory = new ethers.Contract(FACTORIES.UNISWAP_V3, UNISWAP_V3_FACTORY_ABI, provider);
    const feeTiers = [100, 500, 3000, 10000];
    let maxLiquidity = 0;

    for (const fee of feeTiers) {
      const pool = await factory.getPool(token0.address, token1.address, fee);
      if (pool !== ethers.constants.AddressZero) {
        const t0 = new ethers.Contract(token0.address, ERC20_ABI, provider);
        const balance = await t0.balanceOf(pool);
        if (!balance.isZero()) {
          const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance, token0.decimals));
          const price = TOKEN_PRICES_USD[token0.name] || 1;
          const liquidityUSD = balanceFormatted * price;
          if (liquidityUSD > maxLiquidity) maxLiquidity = liquidityUSD;
        }
      }
    }
    if (maxLiquidity > 0) results.uniswap_v3 = maxLiquidity;
  } catch (e) {}

  // Uniswap V2
  try {
    const factory = new ethers.Contract(FACTORIES.UNISWAP_V2, UNISWAP_V2_FACTORY_ABI, provider);
    const pair = await factory.getPair(token0.address, token1.address);
    if (pair !== ethers.constants.AddressZero) {
      const t0 = new ethers.Contract(token0.address, ERC20_ABI, provider);
      const balance = await t0.balanceOf(pair);
      if (!balance.isZero()) {
        const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance, token0.decimals));
        const price = TOKEN_PRICES_USD[token0.name] || 1;
        results.uniswap_v2 = balanceFormatted * price;
      }
    }
  } catch (e) {}

  // Aerodrome
  try {
    const factory = new ethers.Contract(FACTORIES.AERODROME, AERODROME_FACTORY_ABI, provider);
    const pool = await factory.getPool(token0.address, token1.address, false);
    if (pool !== ethers.constants.AddressZero) {
      const t0 = new ethers.Contract(token0.address, ERC20_ABI, provider);
      const balance = await t0.balanceOf(pool);
      if (!balance.isZero()) {
        const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance, token0.decimals));
        const price = TOKEN_PRICES_USD[token0.name] || 1;
        results.aerodrome = balanceFormatted * price;
      }
    }
  } catch (e) {}

  return results;
}

async function main() {
  console.log('Starting Liquidity Audit...');
  const tokenList = Object.keys(TOKENS);
  const pairs = [];

  const stablecoins = ['USDC', 'USDT', 'DAI'];
  const majorTokens = ['WETH', 'cbBTC', 'WBTC', 'LBTC', 'AERO'];

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
  const validPairs = auditReport.filter(r => r.dexes.length >= 2 && 
    Object.values(r.liquidity).some(v => v >= CONFIG.MIN_LIQUIDITY_THRESHOLD_USD));
  console.log(`Total Pairs: ${auditReport.length}`);
  console.log(`Actionable Pairs (Liquidity ≥ $${CONFIG.MIN_LIQUIDITY_THRESHOLD_USD} on 2+ DEXs): ${validPairs.length}`);

  validPairs.forEach(p => {
    console.log(`- ${p.name}: ${p.dexes.join(', ')} | Liquidity USD: ${JSON.stringify(p.liquidity)}`);
  });
}

main();
