const { ethers } = require('ethers');

// Use environment variable for RPC, fallback to public endpoint
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

// CORRECT Factory Addresses on Base Chain
const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da'; // Correct Aerodrome V2
const PANCAKESWAP_V3_FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'; // PancakeSwap V3

// Minimal ABIs
const FACTORY_ABI_V2 = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  'function allPairs(uint) external view returns (address)',
  'function allPairsLength() external view returns (uint)'
];

const V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'
];

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function totalSupply() external view returns (uint)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
];

const V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

const TOKEN_ABI = [
  'function decimals() external view returns (uint8)',
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
  'function balanceOf(address account) external view returns (uint)',
  'function totalSupply() external view returns (uint)'
];

class ArbitrageScanner {
  constructor() {
    this.provider = null;
    this.aerodromeFactory = null;
    this.pancakeswapFactory = null;
    this.tokenCache = new Map();
    this.pairCache = new Map();
    this.requestCount = 0;
    this.maxRequestsPerScan = 300;
  }

  async initialize() {
    try {
      this.provider = new ethers.JsonRpcProvider(BASE_RPC);
      
      this.aerodromeFactory = new ethers.Contract(
        AERODROME_FACTORY,
        FACTORY_ABI_V2,
        this.provider
      );
      
      this.pancakeswapFactory = new ethers.Contract(
        PANCAKESWAP_V3_FACTORY,
        V3_FACTORY_ABI,
        this.provider
      );

      // Test connection
      const blockNumber = await this.provider.getBlockNumber();
      console.log(`✅ Connected to Base Chain - Block: ${blockNumber}`);
      console.log(`📡 RPC Endpoint: ${BASE_RPC}`);
      console.log(`🏢 DEXes: Aerodrome (V2), PancakeSwap (V3)`);
      
      return true;
    } catch (error) {
      console.error('Failed to initialize provider:', error.message);
      throw error;
    }
  }

  log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  async getTokenInfo(tokenAddress) {
    const lowerAddress = tokenAddress.toLowerCase();
    if (this.tokenCache.has(lowerAddress)) {
      return this.tokenCache.get(lowerAddress);
    }

    try {
      this.requestCount++;
      const contract = new ethers.Contract(tokenAddress, TOKEN_ABI, this.provider);
      
      const [decimals, name, symbol] = await Promise.all([
        contract.decimals().catch(() => 18),
        contract.name().catch(() => 'Unknown'),
        contract.symbol().catch(() => 'UNK')
      ]);

      const tokenInfo = {
        address: tokenAddress,
        name,
        symbol,
        decimals: Number(decimals)
      };

      this.tokenCache.set(lowerAddress, tokenInfo);
      return tokenInfo;
    } catch (error) {
      return null;
    }
  }

  async getPairPriceAerodrome(token0, token1) {
    const pairKey = `aero-${token0.toLowerCase()}-${token1.toLowerCase()}`;
    
    if (this.pairCache.has(pairKey)) {
      return this.pairCache.get(pairKey);
    }

    try {
      this.requestCount++;
      const pairAddress = await this.aerodromeFactory.getPair(token0, token1);

      if (pairAddress === ethers.ZeroAddress) {
        return null;
      }

      this.requestCount++;
      const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
      const [[reserve0, reserve1], token0Address, token1Address] = await Promise.all([
        pair.getReserves(),
        pair.token0(),
        pair.token1()
      ]);

      if (reserve0 === 0n || reserve1 === 0n) {
        return null;
      }

      // Fetch decimals
      const token0Info = await this.getTokenInfo(token0Address);
      const token1Info = await this.getTokenInfo(token1Address);
      if (!token0Info || !token1Info) {
        return null;
      }
      const dec0 = token0Info.decimals;
      const dec1 = token1Info.decimals;

      // Raw ratio pool1 / pool0
      const rawRatio = Number(reserve1) / Number(reserve0);

      // Human-adjusted price_pool1_per_pool0
      let price = rawRatio * (10 ** (dec0 - dec1));

      // Normalize to quote (token1_input) per WETH (token0_input)
      const isWethToken0 = token0Address.toLowerCase() === token0.toLowerCase();
      if (!isWethToken0) {
        price = 1 / price;
      }

      const result = {
        dex: 'Aerodrome',
        pair: pairAddress,
        price,
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString()
      };

      this.pairCache.set(pairKey, result);
      return result;
    } catch (error) {
      return null;
    }
  }

  async getPairPricePancakeSwap(token0, token1) {
    const pairKey = `pancake-${token0.toLowerCase()}-${token1.toLowerCase()}`;
    
    if (this.pairCache.has(pairKey)) {
      return this.pairCache.get(pairKey);
    }

    try {
      // Try multiple fee tiers for PancakeSwap V3
      const feeTiers = [500, 2500, 10000, 100]; // 0.05%, 0.25%, 1%, 0.01%
      
      for (const fee of feeTiers) {
        try {
          this.requestCount++;
          const poolAddress = await this.pancakeswapFactory.getPool(token0, token1, fee);

          if (poolAddress === ethers.ZeroAddress) {
            continue;
          }

          this.requestCount++;
          const pair = new ethers.Contract(poolAddress, V3_POOL_ABI, this.provider);
          const [slot0, token0Address, token1Address] = await Promise.all([
            pair.slot0(),
            pair.token0(),
            pair.token1()
          ]);

          const sqrtPriceX96 = slot0[0];
          if (sqrtPriceX96 === 0n) {
            continue;
          }

          // Fetch decimals
          const token0Info = await this.getTokenInfo(token0Address);
          const token1Info = await this.getTokenInfo(token1Address);
          if (!token0Info || !token1Info) {
            continue;
          }
          const dec0 = token0Info.decimals;
          const dec1 = token1Info.decimals;

          // Compute raw price_pool1_per_pool0 = (sqrtPriceX96 / 2^96)^2
          const numerator = sqrtPriceX96 * sqrtPriceX96;
          const denominator = 1n << 192n;
          const rawRatio = Number(numerator) / Number(denominator);

          // Human-adjusted price_pool1_per_pool0
          let price = rawRatio * (10 ** (dec0 - dec1));

          // Normalize to quote (token1_input) per WETH (token0_input)
          const isWethToken0 = token0Address.toLowerCase() === token0.toLowerCase();
          if (!isWethToken0) {
            price = 1 / price;
          }

          const result = {
            dex: 'PancakeSwap',
            pair: poolAddress,
            fee: fee,
            price: price,
            reserve0: 'N/A (V3)', // No direct reserves in V3
            reserve1: 'N/A (V3)'
          };

          this.pairCache.set(pairKey, result);
          return result;
        } catch (e) {
          // Try next fee tier
          continue;
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  async scanForArbitrageOpportunities() {
    const opportunities = [];
    this.requestCount = 0;

    try {
      this.log('🔍 STARTING ARBITRAGE SCAN...');
      this.log(`📊 Scanning WETH against major Base tokens`);
      this.log(`💱 Comparing Aerodrome (V2) vs PancakeSwap (V3)`);
      this.log('');

      const WETH = '0x4200000000000000000000000000000000000006';
      const baseTokens = [
        { symbol: 'USDC', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
        { symbol: 'USDbC', address: '0xd9aAEc86B65D86f6A7B630e2c953757EfB0d5e88' },
        { symbol: 'cbETH', address: '0x2Ae3F1Ec7F1F5012CFEab0411040220A4B217aa8' },
        { symbol: 'DAI', address: '0x50c5725949A6F0c72E6C4a641F14122319976f97' },
        { symbol: 'AERO', address: '0x940181a94A35C424E6D2d6d8313e5E8ab37be8B0' },
        // Added tokens
        { symbol: 'ezETH', address: '0x2416092f143378750bb29b79ed961ab195CcEea5' },
        { symbol: 'rETH', address: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c' },
        { symbol: 'wstETH', address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452' },
        { symbol: 'DEGEN', address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed' },
        { symbol: 'TOSHI', address: '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4' },
        { symbol: 'BRETT', address: '0x532f27101965dd16442E59d40670FaF5eBB142E4' },
      ];

      for (const token of baseTokens) {
        if (this.requestCount > this.maxRequestsPerScan) {
          this.log(`⚠️  RPC limit reached. Stopping scan.`);
          break;
        }

        const pairName = `WETH/${token.symbol}`;
        this.log(`  🔎 ${pairName} - Fetching prices...`);

        const [aeroPrice, panPrice] = await Promise.all([
          this.getPairPriceAerodrome(WETH, token.address),
          this.getPairPricePancakeSwap(WETH, token.address)
        ]);

        let priceLine = '    📊 ';
        
        if (aeroPrice) {
          priceLine += `Aero: ${aeroPrice.price.toFixed(6)}`;
        } else {
          priceLine += `Aero: ✗`;
        }

        priceLine += ' | ';

        if (panPrice) {
          priceLine += `PanCake: ${panPrice.price.toFixed(6)}`;
        } else {
          priceLine += `PanCake: ✗`;
        }

        this.log(priceLine);

        // Check for arbitrage
        if (aeroPrice && panPrice) {
          const priceDiff = Math.abs(aeroPrice.price - panPrice.price);
          const minPrice = Math.min(aeroPrice.price, panPrice.price);
          const percentDiff = (priceDiff / minPrice) * 100;

          if (percentDiff > 0.5) {
            const cheaperDex = aeroPrice.price < panPrice.price ? 'Aerodrome' : 'PancakeSwap';
            const expensiveDex = aeroPrice.price < panPrice.price ? 'PancakeSwap' : 'Aerodrome';
            
            this.log(`    ✅ OPPORTUNITY! ${percentDiff.toFixed(3)}%`);
            this.log(`       Buy on ${cheaperDex} → Sell on ${expensiveDex}`);
            this.log(`       Profit Potential: ${(percentDiff - 0.6).toFixed(3)}%`);

            opportunities.push({
              pair: pairName,
              aeroPrice: aeroPrice.price.toFixed(8),
              panPrice: panPrice.price.toFixed(8),
              difference: percentDiff.toFixed(3),
              cheaperOn: cheaperDex,
              expensiveOn: expensiveDex,
              profitPotential: (percentDiff - 0.6).toFixed(3)
            });
          } else {
            this.log(`    ℹ️  Difference too small: ${percentDiff.toFixed(3)}%`);
          }
        } else if (aeroPrice) {
          this.log(`    ℹ️  Only on Aerodrome - No arbitrage possible`);
        } else if (panPrice) {
          this.log(`    ℹ️  Only on PancakeSwap - No arbitrage possible`);
        } else {
          this.log(`    ❌ No pairs found on any DEX`);
        }

        this.log('');
      }

      // Summary
      this.log(`${'='.repeat(70)}`);
      this.log(`📊 SCAN COMPLETE!`);
      this.log(`Found: ${opportunities.length} arbitrage opportunities`);
      this.log(`RPC Calls Used: ${this.requestCount}/${this.maxRequestsPerScan}`);
      this.log(`${'='.repeat(70)}\n`);

      return opportunities;

    } catch (error) {
      this.log(`❌ Error scanning: ${error.message}`);
      throw error;
    }
  }
}

module.exports = ArbitrageScanner;
