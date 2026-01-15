const { ethers } = require('ethers');
const axios = require('axios');

// Use environment variable for RPC, fallback to public endpoint
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const AERODROME_FACTORY = '0x420DD381B31aEf6683db6B902f2e9735d8e1f93B';
const PANCAKESWAP_FACTORY = '0x01bF23C756e3Ce45222E1e79A681694519923638';

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

// Minimal ABIs
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  'function allPairs(uint) external view returns (address)',
  'function allPairsLength() external view returns (uint)',
  'function createPair(address tokenA, address tokenB) external returns (address pair)'
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
      
      return true;
    } catch (error) {
      console.error('Failed to initialize provider:', error.message);
      throw error;
    }
  }

  async getTokenInfo(tokenAddress) {
    if (this.tokenCache.has(tokenAddress)) {
      return this.tokenCache.get(tokenAddress);
    }

    try {
      const contract = new ethers.Contract(tokenAddress, TOKEN_ABI, this.provider);
      
      const [decimals, name, symbol, totalSupply] = await Promise.all([
        contract.decimals().catch(() => 18),
        contract.name().catch(() => 'Unknown'),
        contract.symbol().catch(() => 'Unknown'),
        contract.totalSupply().catch(() => '0')
      ]);

      const tokenInfo = {
        address: tokenAddress,
        name,
        symbol,
        decimals,
        totalSupply: totalSupply.toString()
      };

      this.tokenCache.set(tokenAddress, tokenInfo);
      return tokenInfo;
    } catch (error) {
      console.error(`Failed to get token info for ${tokenAddress}:`, error.message);
      return null;
    }
  }

  async getPairPrice(factoryName, token0, token1) {
    try {
      const factory = factoryName === 'aerodrome' ? this.aerodromeFactory : this.pancakeswapFactory;
      const pairAddress = await factory.getPair(token0, token1);

      if (pairAddress === ethers.ZeroAddress) {
        return null;
      }

      const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
      const [reserve0, reserve1] = await pair.getReserves();
      const pairToken0 = await pair.token0();

      // Ensure consistent ordering
      let price;
      if (pairToken0.toLowerCase() === token0.toLowerCase()) {
        price = Number(reserve1) / Number(reserve0);
      } else {
        price = Number(reserve0) / Number(reserve1);
      }

      return {
        factory: factoryName,
        pair: pairAddress,
        price: price,
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString()
      };
    } catch (error) {
      return null;
    }
  }

  async scanForArbitrageOpportunities() {
    const opportunities = [];

    try {
      // Get common tokens to scan
      const tokensToScan = [
        WETH,
        USDC,
        '0x2Ae3F1Ec7F1F5012CFEab0411040220A4B217aa8', // cbETH
        '0xd9aAEc86B65D86f6A7B630e2c953757EfB0d5e88', // DEGEN
        '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'  // USDC
      ];

      // Create token pairs
      for (let i = 0; i < tokensToScan.length; i++) {
        for (let j = i + 1; j < tokensToScan.length; j++) {
          const token0 = tokensToScan[i];
          const token1 = tokensToScan[j];

          // Get prices from both DEXes
          const aeroPrice = await this.getPairPrice('aerodrome', token0, token1);
          const panPrice = await this.getPairPrice('pancakeswap', token0, token1);

          // Check for arbitrage opportunity
          if (aeroPrice && panPrice && aeroPrice.price > 0 && panPrice.price > 0) {
            const priceDiff = Math.abs(aeroPrice.price - panPrice.price);
            const percentDiff = (priceDiff / Math.min(aeroPrice.price, panPrice.price)) * 100;

            // Significant price difference detected
            if (percentDiff > 0.5) {
              const [token0Info, token1Info] = await Promise.all([
                this.getTokenInfo(token0),
                this.getTokenInfo(token1)
              ]);

              if (token0Info && token1Info) {
                const opportunity = {
                  token0: {
                    address: token0,
                    symbol: token0Info.symbol,
                    decimals: token0Info.decimals
                  },
                  token1: {
                    address: token1,
                    symbol: token1Info.symbol,
                    decimals: token1Info.decimals
                  },
                  aerodromePrice: aeroPrice.price.toFixed(8),
                  pancakeswapPrice: panPrice.price.toFixed(8),
                  priceDiffPercent: percentDiff.toFixed(2),
                  cheaperOn: aeroPrice.price < panPrice.price ? 'aerodrome' : 'pancakeswap',
                  expensiveOn: aeroPrice.price < panPrice.price ? 'pancakeswap' : 'aerodrome',
                  aerodromeReserves: {
                    reserve0: aeroPrice.reserve0,
                    reserve1: aeroPrice.reserve1
                  },
                  pancakeswapReserves: {
                    reserve0: panPrice.reserve0,
                    reserve1: panPrice.reserve1
                  },
                  timestamp: new Date().toISOString(),
                  profitPotential: (percentDiff - 0.5).toFixed(2) // Accounting for ~0.5% fees
                };

                opportunities.push(opportunity);
              }
            }
          }
        }
      }

      // Sort by profit potential
      opportunities.sort((a, b) => 
        parseFloat(b.profitPotential) - parseFloat(a.profitPotential)
      );

      return opportunities.slice(0, 20); // Return top 20
    } catch (error) {
      console.error('Error scanning for opportunities:', error.message);
      throw error;
    }
  }

  async scanTopPools() {
    const topPools = [];

    try {
      const pairsLength = await this.aerodromeFactory.allPairsLength();
      const limit = Math.min(100, Number(pairsLength)); // Check first 100 pairs

      for (let i = 0; i < limit; i++) {
        try {
          const pairAddress = await this.aerodromeFactory.allPairs(i);
          const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);

          const [token0, token1, totalSupply] = await Promise.all([
            pair.token0(),
            pair.token1(),
            pair.totalSupply()
          ]);

          if (Number(totalSupply) > 0) {
            const [token0Info, token1Info] = await Promise.all([
              this.getTokenInfo(token0),
              this.getTokenInfo(token1)
            ]);

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
          // Skip problematic pairs
          continue;
        }
      }

      return topPools.slice(0, 50);
    } catch (error) {
      console.error('Error scanning top pools:', error.message);
      return [];
    }
  }
}

module.exports = ArbitrageScanner;
