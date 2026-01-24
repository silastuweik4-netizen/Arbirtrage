const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const CONFIG = {
  BASE_CHAIN_ID: 8453,
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  PRICE_DIFFERENCE_THRESHOLD: parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD) || 0.5,
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS) || 15000,
  WEBHOOK_URL: process.env.WEBHOOK_URL || null,
  TRADE_SIZE: process.env.TRADE_SIZE || '1',
  MIN_LIQUIDITY_USD: parseInt(process.env.MIN_LIQUIDITY_USD) || 10000,
  POOL_DISCOVERY_BLOCKS: parseInt(process.env.POOL_DISCOVERY_BLOCKS) || 100000, // How far back to look for PoolCreated events
};

const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== ABIS ====================
const ERC20_ABI = ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'];
const UNISWAP_V3_QUOTER_ABI = ['function quoteExactInputSingle(address,address,uint24,uint256,uint160) external view returns (uint256)'];
const UNISWAP_V2_ROUTER_ABI = ['function getAmountsOut(uint,address[]) view returns (uint[])'];
const AERODROME_ROUTER_ABI = ['function getAmountsOut(uint256,tuple(address from,address to,bool stable,address factory)[]) view returns (uint256[])'];

// Factory ABIs with the PoolCreated event
const UNISWAP_V3_FACTORY_ABI = ["event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)"];
const AERODROME_FACTORY_ABI = ["event PoolCreated(address indexed token0, address indexed token1, bool indexed stable, address pool)"];

// ==================== DEX ADDRESSES ====================
const DEX_ADDRESSES = {
  UNISWAP_V3_QUOTER: '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6',
  UNISWAP_V2_ROUTER: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  AERODROME_ROUTER: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  UNISWAP_V3_FACTORY: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  AERODROME_FACTORY: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
};

// ==================== TRIANGULAR ROUTES ====================
let TRIANGULAR_ROUTES = [];

// ==================== PRICE & LIQUIDITY FETCHER ====================
// (This class remains the same)
class PriceFetcher {
  constructor() {
    this.quoterV3 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V3_QUOTER, UNISWAP_V3_QUOTER_ABI, provider);
    this.routerV2 = new ethers.Contract(DEX_ADDRESSES.UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_ABI, provider);
    this.aerodromeRouter = new ethers.Contract(DEX_ADDRESSES.AERODROME_ROUTER, AERODROME_ROUTER_ABI, provider);
  }
  async getPrice(token0, token1, dexType, tradeSize, meta = {}) {
    const amountIn = ethers.utils.parseUnits(tradeSize, token0.decimals);
    try {
      if (dexType === 'uniswap_v3') {
        const fee = meta?.feeTiers?.[0] || 3000;
        const out = await this.quoterV3.callStatic.quoteExactInputSingle(token0.address, token1.address, fee, amountIn, 0);
        return out;
      } else if (dexType === 'uniswap_v2') {
        const amounts = await this.routerV2.getAmountsOut(amountIn, [token0.address, token1.address]);
        return amounts[1];
      } else if (dexType === 'aerodrome') {
        const routes = [{ from: token0.address, to: token1.address, stable: meta?.stable || false, factory: DEX_ADDRESSES.AERODROME_FACTORY }];
        const amounts = await this.aerodromeRouter.getAmountsOut(amountIn, routes);
        return amounts[1];
      }
    } catch (error) { return null; }
    return null;
  }
  async getBestQuote(tokenIn, tokenOut, tradeSize, meta = {}) {
    const quote = await this.getPrice(tokenIn, tokenOut, meta.dex, tradeSize, meta);
    if (!quote) return { bestOut: 0, bestVenue: null };
    const val = parseFloat(ethers.utils.formatUnits(quote, tokenOut.decimals));
    return { bestOut: val, bestVenue: `${meta.dex}_${meta.pairAddress.slice(-6)}` };
  }
}

// ==================== ON-CHAIN POOL DISCOVERY ====================
// This class finds pools by querying historical event logs from the blockchain.
class OnChainPoolDiscovery {
    constructor() {
        this.factories = {
            uniswap_v3: { address: DEX_ADDRESSES.UNISWAP_V3_FACTORY, abi: UNISWAP_V3_FACTORY_ABI, isV3: true },
            aerodrome: { address: DEX_ADDRESSES.AERODROME_FACTORY, abi: AERODROME_FACTORY_ABI, isV3: true },
        };
    }

    async discoverAllPools() {
        console.log("\n======================================================");
        console.log("=== FETCHING POOLS FROM ON-CHAIN EVENT LOGS ===");
        console.log("======================================================");
        
        const allPools = [];
        const latestBlock = await provider.getBlockNumber();
        const fromBlock = latestBlock - CONFIG.POOL_DISCOVERY_BLOCKS;

        for (const [dex, factoryInfo] of Object.entries(this.factories)) {
            console.log(`[On-Chain] Discovering pools for ${dex} from block ${fromBlock} to ${latestBlock}...`);
            const factory = new ethers.Contract(factoryInfo.address, factoryInfo.abi, provider);
            
            const filter = factory.filters.PoolCreated();
            const events = await factory.queryFilter(filter, fromBlock, 'latest');
            
            console.log(`[On-Chain] Found ${events.length} PoolCreated events for ${dex}.`);

            for (const event of events) {
                let token0, token1, poolAddress;
                if (dex === 'uniswap_v3') {
                    token0 = { address: event.args.token0, name: `Token_${event.args.token0.slice(0,6)}`, decimals: 18 };
                    token1 = { address: event.args.token1, name: `Token_${event.args.token1.slice(0,6)}`, decimals: 18 };
                    poolAddress = event.args.pool;
                } else if (dex === 'aerodrome') {
                    token0 = { address: event.args.token0, name: `Token_${event.args.token0.slice(0,6)}`, decimals: 18 };
                    token1 = { address: event.args.token1, name: `Token_${event.args.token1.slice(0,6)}`, decimals: 18 };
                    poolAddress = event.args.pool;
                }
                
                allPools.push({
                    dex: dex,
                    pairAddress: poolAddress,
                    token0: token0,
                    token1: token1,
                    meta: { 
                        feeTiers: dex === 'uniswap_v3' ? [event.args.fee] : [500], // Aerodrome V3 has a default fee
                        stable: dex === 'aerodrome' ? event.args.stable : false 
                    }
                });
            }
        }

        // Filter for liquidity and de-duplicate
        const uniquePools = new Map();
        for (const pool of allPools) {
            // This is a simplified liquidity check. A real one would query token balances.
            // For now, we just de-duplicate.
            if (!uniquePools.has(pool.pairAddress)) {
                uniquePools.set(pool.pairAddress, pool);
            }
        }

        const finalPoolList = Array.from(uniquePools.values());
        console.log(`\n[On-Chain Discovery Complete] Found a total of ${finalPoolList.length} unique pools.\n`);
        return finalPoolList;
    }
}


// ==================== ARBITRAGE DETECTOR ====================
class ArbitrageDetector {
    constructor() { 
        this.prices = new PriceFetcher();
        this.discovery = new OnChainPoolDiscovery(); // Use the new on-chain discovery
        this.allMonitoredPools = []; 
    }

    async refreshPoolList() {
        this.allMonitoredPools = await this.discovery.discoverAllPools();
        this.generateTriangularRoutes();
    }

    generateTriangularRoutes() {
        // ... (This method remains the same)
    }

    async getSpreadData(pair) {
        // ... (This method remains the same)
    }

    async scan() {
        // ... (This method remains the same)
    }
}

// ==================== EXECUTION ====================
async function main() {
  const detector = new ArbitrageDetector();
  await detector.refreshPoolList();
  await detector.scan();
  setInterval(() => detector.scan(), CONFIG.CHECK_INTERVAL_MS);
  setInterval(() => { console.log("\n[Periodic Check] Refreshing pool list..."); detector.refreshPoolList(); }, 3600000);

  const http = require('http');
  const port = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.statusCode = 200; res.setHeader('Content-Type', 'text/plain'); res.end('On-Chain Arbitrage Bot is running.\n');
  }).listen(port, () => console.log(`Health check server on port ${port}`));
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
