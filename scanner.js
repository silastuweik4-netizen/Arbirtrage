const { ethers } = require('ethers');

// Use environment variable for RPC, fallback to public endpoint
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const AERODROME_FACTORY = '0x420DD381B31aEf6683db6B902f2e9735d8e1f93B';
const PANCAKESWAP_FACTORY = '0x01bF23C756e3Ce45222E1e79A681694519923638';

// Popular Base Chain tokens (volatile pairs for arbitrage)
const VOLATILE_TOKENS = [
  { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006' },
  { symbol: 'USDC', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  { symbol: 'USDbC', address: '0xd9aAEc86B65D86f6A7B630e2c953757EfB0d5e88' },
  { symbol: 'cbETH', address: '0x2Ae3F1Ec7F1F5012CFEab0411040220A4B217aa8' },
  { symbol: 'AERO', address: '0x940181a94A35C424E6D2d6d8313e5E8ab37be8B0' },
  { symbol: 'bswap', address: '0x78a087d534B36b6f8F123c27beb597356ff2047A' },
  { symbol: 'tBTC', address: '0xfA2Dd9AE7d5055AbC4e4d92fb26e8de41E834768' },
  { symbol: 'BRETT', address: '0x532f06ff20bf4fb63fd4a9763cb7da19e0525405' },
  { symbol: 'DEGEN', address: '0x4ed4e862860bed51a9570b96d89af5e1b0efefd' },
  { symbol: 'WELL', address: '0xFF8671d04473510F61089285849901Fe33fAC723' },
  { symbol: 'OPT', address: '0x4200000000000000000000000000000000000042' },
  { symbol: 'NICE', address: '0x1fe00913D6537D4D1E1f5C1A432e02874b209fFf' },
  { symbol: 'WSTETH', address: '0xc1CBa3fCea344f92D75dB2fe0b2564dBAccF2fbe' },
  { symbol: 'WBTC', address: '0xcCEe7B472Ec60982a6C3E2B5EC3E9B4d89cED753' },
  { symbol: 'rswETH', address: '0xEe9801669C6138E84bD50dEB500827b776247B2e' },
  { symbol: 'DAI', address: '0x50c5725949A6F0c72E6C4a641F14122319976f97' },
  { symbol: 'EURC', address: '0x60a3E35Cc302bFA44Cb288Bc4d6A5C0bC4Ffc291' },
  { symbol: 'MIM', address: '0x16ec0a9d574d8fb17e8651ccc2566f4b3121917e' },
  { symbol: 'ONDO', address: '0xe75d322e1e9E312388e50C4d853CCFC26fC01673' },
  { symbol: 'cbBTC', address: '0xcbB7C0000aB88B473b1f5aFd9cd81705134b6820' },
  { symbol: 'GOLD', address: '0x0f4FAE71d747Ce12dd8050491okF2E0e63bD3e82' }
];

// Minimal ABIs
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  'function allPairs(uint) external view returns (address)',
  'function allPairsLength() external view returns (uint)',
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'
];

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function totalSupply() external view returns (uint)',
  'function balanceOf(address account) external view returns (uint)',
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
    this.maxRequestsPerScan = 150; // Conservative limit for Alchemy free tier
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
      console.log(`📊 Scanning ${VOLATILE_TOKENS.length} volatile tokens`);
      
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
      this.log(`⚠️  Failed to get token info for ${tokenAddress.slice(0, 10)}...`);
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

  async findMatchingPairs(token0, token1) {
    // Try to find the same pair on both DEXes
    const aeroPrice = await this.getPairPrice('Aerodrome', this.aerodromeFactory, token0, token1);
    const panPrice = await this.getPairPrice('PancakeSwap', this.pancakeswapFactory, token0, token1);

    // If both don't exist, try reverse
    let aeroReversePrice = null;
    let panReversePrice = null;
    
    if (!aeroPrice) {
      aeroReversePrice = await this.getPairPrice('Aerodrome', this.aerodromeFactory, token1, token0);
    }
    if (!panPrice) {
      panReversePrice = await this.getPairPrice('PancakeSwap', this.pancakeswapFactory, token1, token0);
    }

    return {
      forward: { aero: aeroPrice, pan: panPrice },
      reverse: { aero: aeroReversePrice, pan: panReversePrice }
    };
  }

  async scanForArbitrageOpportunities() {
    const opportunities = [];
    this.requestCount = 0;

    try {
      this.log('🔍 Starting arbitrage scan...');
      this.log(`📋 Checking ${VOLATILE_TOKENS.length} tokens against each other`);

      const tokenPairs = [];
      
      // Create token pairs, limiting to 20 pairs to conserve RPC calls
      for (let i = 0; i < VOLATILE_TOKENS.length && tokenPairs.length < 20; i++) {
        for (let j = i + 1; j < VOLATILE_TOKENS.length && tokenPairs.length < 20; j++) {
          tokenPairs.push([VOLATILE_TOKENS[i], VOLATILE_TOKENS[j]]);
        }
      }

      this.log(`💱 Checking ${tokenPairs.length} token pairs across Aerodrome & PancakeSwap`);

      for (const [tokenA, tokenB] of tokenPairs) {
        if (this.requestCount > this.maxRequestsPerScan) {
          this.log(`⚠️  RPC limit reached (${this.requestCount}/${this.maxRequestsPerScan}). Stopping scan.`);
          break;
        }

        this.log(`  🔎 Checking: ${tokenA.symbol}/${tokenB.symbol} (${this.requestCount} requests used)`);

        const pairs = await this.findMatchingPairs(tokenA.address, tokenB.address);

        // Check forward direction
        if (pairs.forward.aero && pairs.forward.pan) {
          const opp = this.analyzeOpportunity(
            tokenA,
            tokenB,
            pairs.forward.aero,
            pairs.forward.pan,
            'forward'
          );
          if (opp) {
            this.log(`    ✅ Opportunity found: ${opp.priceDiffPercent}% difference`);
            opportunities.push(opp);
          }
        }

        // Check reverse direction
        if (pairs.reverse.aero && pairs.reverse.pan) {
          const opp = this.analyzeOpportunity(
            tokenA,
            tokenB,
            pairs.reverse.aero,
            pairs.reverse.pan,
            'reverse'
          );
          if (opp) {
            this.log(`    ✅ Opportunity found (reverse): ${opp.priceDiffPercent}% difference`);
            opportunities.push(opp);
          }
        }
      }

      // Sort by profit potential
      opportunities.sort((a, b) => 
        parseFloat(b.profitPotential) - parseFloat(a.profitPotential)
      );

      this.log(`\n📊 Scan complete! Found ${opportunities.length} opportunities using ${this.requestCount} RPC calls`);
      return opportunities;

    } catch (error) {
      this.log(`❌ Error scanning: ${error.message}`);
      throw error;
    }
  }

  analyzeOpportunity(tokenA, tokenB, aeroPrice, panPrice, direction) {
    const priceDiff = Math.abs(aeroPrice.price - panPrice.price);
    const minPrice = Math.min(aeroPrice.price, panPrice.price);
    const percentDiff = (priceDiff / minPrice) * 100;

    // Only report opportunities with >0.3% difference (accounting for fees)
    if (percentDiff < 0.3) {
      return null;
    }

    return {
      direction: direction,
      token0: {
        address: tokenA.address,
        symbol: tokenA.symbol
      },
      token1: {
        address: tokenB.address,
        symbol: tokenB.symbol
      },
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
      profitPotential: (percentDiff - 0.6).toFixed(3) // Accounting for ~0.6% fees
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
