const { ethers } = require('ethers');

// Use environment variable for RPC, fallback to public endpoint
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const AERODROME_FACTORY = '0x420DD381B31aEf6683db6B902f2e9735d8e1f93B';
const PANCAKESWAP_FACTORY = '0x01bF23C756e3Ce45222E1e79A681694519923638';

// Known liquid pairs on Base (these actually exist and are tradable)
const KNOWN_LIQUID_PAIRS = [
  // WETH pairs
  { token0: '0x4200000000000000000000000000000000000006', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'WETH/USDC' },
  { token0: '0x4200000000000000000000000000000000000006', token1: '0xd9aAEc86B65D86f6A7B630e2c953757EfB0d5e88', name: 'WETH/USDbC' },
  { token0: '0x4200000000000000000000000000000000000006', token1: '0x50c5725949A6F0c72E6C4a641F14122319976f97', name: 'WETH/DAI' },
  
  // USDC pairs
  { token0: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', token1: '0xd9aAEc86B65D86f6A7B630e2c953757EfB0d5e88', name: 'USDC/USDbC' },
  { token0: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', token1: '0x50c5725949A6F0c72E6C4a641F14122319976f97', name: 'USDC/DAI' },
  
  // cbETH pairs
  { token0: '0x2Ae3F1Ec7F1F5012CFEab0411040220A4B217aa8', token1: '0x4200000000000000000000000000000000000006', name: 'cbETH/WETH' },
  
  // AERO pairs (Aerodrome token)
  { token0: '0x940181a94A35C424E6D2d6d8313e5E8ab37be8B0', token1: '0x4200000000000000000000000000000000000006', name: 'AERO/WETH' },
  { token0: '0x940181a94A35C424E6D2d6d8313e5E8ab37be8B0', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'AERO/USDC' },
  
  // DEGEN pairs
  { token0: '0x4ed4e862860bed51a9570b96d89af5e1b0efefd', token1: '0x4200000000000000000000000000000000000006', name: 'DEGEN/WETH' },
  { token0: '0x4ed4e862860bed51a9570b96d89af5e1b0efefd', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'DEGEN/USDC' },
  
  // tBTC pairs
  { token0: '0xfA2Dd9AE7d5055AbC4e4d92fb26e8de41E834768', token1: '0x4200000000000000000000000000000000000006', name: 'tBTC/WETH' },
  { token0: '0xfA2Dd9AE7d5055AbC4e4d92fb26e8de41E834768', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'tBTC/USDC' },
  
  // BRETT pairs
  { token0: '0x532f06ff20bf4fb63fd4a9763cb7da19e0525405', token1: '0x4200000000000000000000000000000000000006', name: 'BRETT/WETH' },
  { token0: '0x532f06ff20bf4fb63fd4a9763cb7da19e0525405', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'BRETT/USDC' },
  
  // WBTC pairs
  { token0: '0xcCEe7B472Ec60982a6C3E2B5EC3E9B4d89cED753', token1: '0x4200000000000000000000000000000000000006', name: 'WBTC/WETH' },
  { token0: '0xcCEe7B472Ec60982a6C3E2B5EC3E9B4d89cED753', token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'WBTC/USDC' },
];

// Minimal ABIs
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  'function allPairs(uint) external view returns (address)',
  'function allPairsLength() external view returns (uint)'
];

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function totalSupply() external view returns (uint)',
  'function decimals() external view returns (uint8)',
  'function name() external view returns (string)',
  'function symbol() external view returns (string)'
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
    this.maxRequestsPerScan = 200;
  }

  async initialize() {
    try {
      this.provider = new ethers.JsonRpcProvider(BASE_RPC);
      
      this.aerodromeFactory = new ethers.Contract(
        AERODROME_FACTORY,
        FACTORY_ABI,
        this.provider
      );
      
      this.pancakeswapFactory = new ethers.Contract(
        PANCAKESWAP_FACTORY,
        FACTORY_ABI,
        this.provider
      );

      // Test connection
      const blockNumber = await this.provider.getBlockNumber();
      console.log(`✅ Connected to Base Chain - Block: ${blockNumber}`);
      console.log(`📡 RPC Endpoint: ${BASE_RPC}`);
      console.log(`📊 Scanning ${KNOWN_LIQUID_PAIRS.length} known liquid pairs`);
      console.log(`🏢 DEXes: Aerodrome, PancakeSwap`);
      
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
    if (this.tokenCache.has(tokenAddress)) {
      return this.tokenCache.get(tokenAddress);
    }

    try {
      this.requestCount++;
      const contract = new ethers.Contract(tokenAddress, TOKEN_ABI, this.provider);
      
      const [decimals, name, symbol] = await Promise.all([
        contract.decimals().catch(() => 18),
        contract.name().catch(() => 'Unknown'),
        contract.symbol().catch(() => 'Unknown')
      ]);

      const tokenInfo = {
        address: tokenAddress,
        name,
        symbol,
        decimals
      };

      this.tokenCache.set(tokenAddress, tokenInfo);
      return tokenInfo;
    } catch (error) {
      return null;
    }
  }

  async getPairPrice(dexName, factory, token0, token1) {
    const pairKey = `${dexName}-${token0.toLowerCase()}-${token1.toLowerCase()}`;
    
    if (this.pairCache.has(pairKey)) {
      return this.pairCache.get(pairKey);
    }

    try {
      this.requestCount++;
      const pairAddress = await factory.getPair(token0, token1);

      if (pairAddress === ethers.ZeroAddress) {
        return null;
      }

      this.requestCount++;
      const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
      const [reserve0, reserve1, token0Address] = await Promise.all([
        pair.getReserves().then(r => r[0]),
        pair.getReserves().then(r => r[1]),
        pair.token0()
      ]);

      // Validate reserves
      if (reserve0 === 0n || reserve1 === 0n) {
        return null;
      }

      // Calculate price with consistent ordering
      let price;
      if (token0Address.toLowerCase() === token0.toLowerCase()) {
        price = Number(reserve1) / Number(reserve0);
      } else {
        price = Number(reserve0) / Number(reserve1);
      }

      const result = {
        dex: dexName,
        pair: pairAddress,
        price: price,
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString(),
        timestamp: Date.now()
      };

      this.pairCache.set(pairKey, result);
      return result;
    } catch (error) {
      return null;
    }
  }

  logPairPrices(pairLabel, aeroPrice, panPrice) {
    const aeroStr = aeroPrice ? `Aero: ${aeroPrice.price.toFixed(6)}` : 'Aero: ✗';
    const panStr = panPrice ? `PanCake: ${panPrice.price.toFixed(6)}` : 'PanCake: ✗';
    
    this.log(`    📊 ${pairLabel}`);
    this.log(`       ${aeroStr} | ${panStr}`);
  }

  async scanForArbitrageOpportunities() {
    const opportunities = [];
    this.requestCount = 0;

    try {
      this.log('🔍 Starting arbitrage scan on KNOWN LIQUID PAIRS...');
      this.log(`💱 Checking ${KNOWN_LIQUID_PAIRS.length} pairs across Aerodrome & PancakeSwap`);

      for (const pair of KNOWN_LIQUID_PAIRS) {
        if (this.requestCount > this.maxRequestsPerScan) {
          this.log(`⚠️  RPC limit reached (${this.requestCount}/${this.maxRequestsPerScan}). Stopping scan.`);
          break;
        }

        this.log(`\n  🔎 Checking: ${pair.name} (${this.requestCount} requests used)`);

        // Get prices from both DEXes
        const aeroPrice = await this.getPairPrice('Aerodrome', this.aerodromeFactory, pair.token0, pair.token1);
        const panPrice = await this.getPairPrice('PancakeSwap', this.pancakeswapFactory, pair.token0, pair.token1);

        if (!aeroPrice && !panPrice) {
          this.log(`    ❌ Pair not found on any DEX`);
          continue;
        }

        // Log prices found
        this.logPairPrices(pair.name, aeroPrice, panPrice);

        // Check if we have both prices for arbitrage
        if (aeroPrice && panPrice) {
          const opp = this.analyzeOpportunity(pair, aeroPrice, panPrice);
          if (opp) {
            this.log(`    ✅ OPPORTUNITY! ${opp.priceDiffPercent}% | Buy ${opp.cheaperOn} → Sell ${opp.expensiveOn} | Profit: ${opp.profitPotential}%`);
            opportunities.push(opp);
          } else {
            this.log(`    ℹ️  Difference too small (< 0.3%)`);
          }
        } else if (aeroPrice) {
          this.log(`    ℹ️  Only on Aerodrome (no arbitrage possible)`);
        } else if (panPrice) {
          this.log(`    ℹ️  Only on PancakeSwap (no arbitrage possible)`);
        }
      }

      // Sort by profit potential
      opportunities.sort((a, b) => 
        parseFloat(b.profitPotential) - parseFloat(a.profitPotential)
      );

      this.log(`\n${'='.repeat(70)}`);
      this.log(`📊 SCAN COMPLETE!`);
      this.log(`Found: ${opportunities.length} arbitrage opportunities`);
      this.log(`RPC Calls: ${this.requestCount}/${this.maxRequestsPerScan}`);
      this.log(`${'='.repeat(70)}\n`);

      return opportunities;

    } catch (error) {
      this.log(`❌ Error scanning: ${error.message}`);
      throw error;
    }
  }

  analyzeOpportunity(pair, aeroPrice, panPrice) {
    const priceDiff = Math.abs(aeroPrice.price - panPrice.price);
    const minPrice = Math.min(aeroPrice.price, panPrice.price);
    const percentDiff = (priceDiff / minPrice) * 100;

    // Only report opportunities with >0.3% difference
    if (percentDiff < 0.3) {
      return null;
    }

    return {
      pairName: pair.name,
      token0: pair.token0,
      token1: pair.token1,
      aerodromePrice: aeroPrice.price.toFixed(8),
      pancakeswapPrice: panPrice.price.toFixed(8),
      priceDiffPercent: percentDiff.toFixed(3),
      cheaperOn: aeroPrice.price < panPrice.price ? 'Aerodrome' : 'PancakeSwap',
      expensiveOn: aeroPrice.price < panPrice.price ? 'PancakeSwap' : 'Aerodrome',
      aerodromeReserves: {
        reserve0: aeroPrice.reserve0,
        reserve1: aeroPrice.reserve1
      },
      pancakeswapReserves: {
        reserve0: panPrice.reserve0,
        reserve1: panPrice.reserve1
      },
      timestamp: new Date().toISOString(),
      profitPotential: (percentDiff - 0.6).toFixed(3)
    };
  }

  async scanTopPools() {
    const topPools = [];
    this.requestCount = 0;

    try {
      this.log('🏊 Scanning top Aerodrome pools...');
      
      const pairsLength = await this.aerodromeFactory.allPairsLength();
      this.requestCount++;
      
      const limit = Math.min(50, Math.min(Number(pairsLength), 50));
      this.log(`📋 Checking first ${limit} pairs`);

      for (let i = 0; i < limit && this.requestCount < this.maxRequestsPerScan; i++) {
        try {
          this.requestCount++;
          const pairAddress = await this.aerodromeFactory.allPairs(i);
          
          this.requestCount++;
          const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
          const [token0, token1, totalSupply] = await Promise.all([
            pair.token0(),
            pair.token1(),
            pair.totalSupply()
          ]);

          if (Number(totalSupply) > 0) {
            const token0Info = await this.getTokenInfo(token0);
            const token1Info = await this.getTokenInfo(token1);

            if (token0Info && token1Info) {
              topPools.push({
                pair: pairAddress,
                token0: token0Info.symbol,
                token1: token1Info.symbol,
                liquidity: totalSupply.toString()
              });
            }
          }
        } catch (e) {
          continue;
        }
      }

      this.log(`✅ Found ${topPools.length} pools`);
      return topPools;
    } catch (error) {
      this.log(`⚠️  Error scanning pools: ${error.message}`);
      return [];
    }
  }
}

module.exports = ArbitrageScanner;
