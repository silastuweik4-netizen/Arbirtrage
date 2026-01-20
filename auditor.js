const { ethers } = require('ethers');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const CONFIG = {
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  MIN_LIQUIDITY_THRESHOLD_USD: 5000, // Minimum liquidity in USD to consider a pool "active"
};

const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== ABIS ====================
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)'
];

const UNISWAP_V3_FACTORY_ABI = [
  'function getPool(address,address,uint24) view returns (address)'
];

const UNISWAP_V2_FACTORY_ABI = [
  'function getPair(address,address) view returns (address)'
];

const AERODROME_FACTORY_ABI = [
  'function getPool(address,address,bool) view returns (address)'
];

const PANCAKESWAP_V3_FACTORY_ABI = [
  'function getPool(address,address,uint24) view returns (address)'
];

// ==================== FACTORY ADDRESSES ====================
const FACTORIES = {
  UNISWAP_V3: '0x33128a8fc17869897dcE68Ed026d694621f6FDFd',
  UNISWAP_V2: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
  AERODROME: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
  PANCAKESWAP_V3: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'
};

// ==================== TOKENS ====================
const TOKENS = {
  WETH: {
    address: '0x4200000000000000000000000000000000000006',
    name: 'WETH',
    decimals: 18
  },
  USDC: {
    address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    name: 'USDC',
    decimals: 6
  },
  USDT: {
    address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    name: 'USDT',
    decimals: 6
  },
  DAI: {
    address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
    name: 'DAI',
    decimals: 18
  }
};

// ==================== TOKEN PRICES (USD) ====================
const TOKEN_PRICES_USD = {
  WETH: 2500,
  USDC: 1,
  USDT: 1,
  DAI: 1
};

// ==================== SIMPLE AUDITOR ====================
async function checkLiquidity(factoryType, token0, token1) {
  try {
    if (factoryType === 'UNISWAP_V3' || factoryType === 'PANCAKESWAP_V3') {
      const abi = factoryType === 'UNISWAP_V3' ? UNISWAP_V3_FACTORY_ABI : PANCAKESWAP_V3_FACTORY_ABI;
      const factory = new ethers.Contract(FACTORIES[factoryType], abi, provider);
      const feeTiers = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%

      for (const fee of feeTiers) {
        const poolAddress = await factory.getPool(token0.address, token1.address, fee);
        if (poolAddress === ethers.constants.AddressZero) {
          console.log(`❌ No ${factoryType} pool for ${token0.name}/${token1.name} @ fee ${(fee/10000).toFixed(2)}%`);
          continue;
        }

        const t0 = new ethers.Contract(token0.address, ERC20_ABI, provider);
        const t1 = new ethers.Contract(token1.address, ERC20_ABI, provider);

        const bal0 = await t0.balanceOf(poolAddress);
        const bal1 = await t1.balanceOf(poolAddress);

        const bal0USD = parseFloat(ethers.utils.formatUnits(bal0, token0.decimals)) * (TOKEN_PRICES_USD[token0.name] || 0);
        const bal1USD = parseFloat(ethers.utils.formatUnits(bal1, token1.decimals)) * (TOKEN_PRICES_USD[token1.name] || 0);

        const totalUSD = bal0USD + bal1USD;

        if (totalUSD >= CONFIG.MIN_LIQUIDITY_THRESHOLD_USD) {
          console.log(`✅ ${factoryType} Pool ${token0.name}/${token1.name} @ fee ${(fee/10000).toFixed(2)}% | Address: ${poolAddress} | Liquidity: $${totalUSD.toFixed(2)}`);
        } else {
          console.log(`⚠️ ${factoryType} Pool ${token0.name}/${token1.name} @ fee ${(fee/10000).toFixed(2)}% | Address: ${poolAddress} | Liquidity below threshold: $${totalUSD.toFixed(2)}`);
        }
      }
      return;
    }

    let poolAddress = ethers.constants.AddressZero;
    if (factoryType === 'UNISWAP_V2') {
      const factory = new ethers.Contract(FACTORIES.UNISWAP_V2, UNISWAP_V2_FACTORY_ABI, provider);
      poolAddress = await factory.getPair(token0.address, token1.address);
    } else if (factoryType === 'AERODROME') {
      const factory = new ethers.Contract(FACTORIES.AERODROME, AERODROME_FACTORY_ABI, provider);
      poolAddress = await factory.getPool(token0.address, token1.address, false);
    }

    if (poolAddress === ethers.constants.AddressZero) {
      console.log(`❌ No pool found for ${token0.name}/${token1.name} on ${factoryType}`);
      return;
    }

    const t0 = new ethers.Contract(token0.address, ERC20_ABI, provider);
    const t1 = new ethers.Contract(token1.address, ERC20_ABI, provider);

    const bal0 = await t0.balanceOf(poolAddress);
    const bal1 = await t1.balanceOf(poolAddress);

    const bal0USD = parseFloat(ethers.utils.formatUnits(bal0, token0.decimals)) * (TOKEN_PRICES_USD[token0.name] || 0);
    const bal1USD = parseFloat(ethers.utils.formatUnits(bal1, token1.decimals)) * (TOKEN_PRICES_USD[token1.name] || 0);

    const totalUSD = bal0USD + bal1USD;

    if (totalUSD >= CONFIG.MIN_LIQUIDITY_THRESHOLD_USD) {
      console.log(`✅ ${factoryType} Pool ${token0.name}/${token1.name} | Address: ${poolAddress} | Liquidity: $${totalUSD.toFixed(2)}`);
    } else {
      console.log(`⚠️ ${factoryType} Pool ${token0.name}/${token1.name} | Address: ${poolAddress} | Liquidity below threshold: $${totalUSD.toFixed(2)}`);
    }
  } catch (e) {
    console.log(`⚠️ Liquidity check failed for ${token0.name}/${token1.name} on ${factoryType}: ${e.message}`);
  }
}

// ==================== EXECUTION ====================
async function main() {
  const tokens = Object.values(TOKENS);

  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      const token0 = tokens[i];
      const token1 = tokens[j];

      await checkLiquidity('UNISWAP_V3', token0, token1);
      await checkLiquidity('UNISWAP_V2', token0, token1);
      await checkLiquidity('AERODROME', token0, token1);
      await checkLiquidity('PANCAKESWAP_V3', token0, token1);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
