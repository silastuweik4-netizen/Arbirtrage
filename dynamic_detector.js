// dynamic_detector.js
require("dotenv").config();
const { ethers } = require("ethers");
const { executeArb } = require("./arbexecutor");

// ==================== CONFIG ====================
const CONFIG = {
  RPC_URL: process.env.RPC_URL || "https://base.llamarpc.com",
  PRICE_DIFFERENCE_THRESHOLD: parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD || "0.5"), // Lowered for more opportunities
  CHECK_INTERVAL_MS: parseInt(process.env.CHECK_INTERVAL_MS || "5000"), // Faster scanning
  TRADE_SIZE_ETH: process.env.TRADE_SIZE_ETH || "0.1", // Base trade size in ETH
  MIN_LIQUIDITY_USD: parseFloat(process.env.MIN_LIQUIDITY_USD || "5000"),
  ARB_CONTRACT_ADDRESS: process.env.ARB_CONTRACT_ADDRESS
};

const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);

// ==================== DEX CONFIG ====================
const DEXES = [
  {
    name: "uniswap_v3",
    quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    router: "0x2626664c2603336E57B271c5C0b26F421741e481",
    type: "v3"
  },
  {
    name: "aerodrome",
    router: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
    factory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    type: "aerodrome"
  },
  {
    name: "uniswap_v2",
    router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
    factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
    type: "v2"
  }
];

// ==================== TOKENS ====================
const TOKENS = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  cbBTC: "0xcbB7C915417833f50075de95246D504f013c144f",
  AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631"
};

// ==================== DYNAMIC ROUTING ENGINE ====================
class DynamicRouter {
  constructor() {
    this.tokenList = Object.values(TOKENS);
  }

  async findBestArb() {
    console.log(`\n🔍 Scanning for dynamic arbitrage opportunities...`);
    
    // 1. Simple 2-hop arbitrage (TokenA -> TokenB -> TokenA)
    for (let i = 0; i < this.tokenList.length; i++) {
      for (let j = 0; j < this.tokenList.length; j++) {
        if (i === j) continue;
        
        const tokenA = this.tokenList[i];
        const tokenB = this.tokenList[j];
        
        await this.checkPair(tokenA, tokenB);
      }
    }
  }

  async checkPair(tokenA, tokenB) {
    const amountIn = ethers.utils.parseEther(CONFIG.TRADE_SIZE_ETH);
    
    // Get quotes from all DEXes for A -> B
    const buyQuotes = await this.getAllQuotes(tokenA, tokenB, amountIn);
    
    // Get quotes from all DEXes for B -> A
    for (const buy of buyQuotes) {
      if (buy.amountOut.isZero()) continue;
      
      const sellQuotes = await this.getAllQuotes(tokenB, tokenA, buy.amountOut);
      
      for (const sell of sellQuotes) {
        if (sell.amountOut.isZero()) continue;
        
        const profit = sell.amountOut.sub(amountIn);
        const profitPercent = (parseFloat(ethers.utils.formatEther(profit)) / parseFloat(ethers.utils.formatEther(amountIn))) * 100;
        
        if (profitPercent > CONFIG.PRICE_DIFFERENCE_THRESHOLD) {
          console.log(`✅ FOUND: ${buy.dex} -> ${sell.dex} | Profit: ${profitPercent.toFixed(4)}%`);
          await this.executeDynamicArb(tokenA, tokenB, amountIn, buy, sell);
        }
      }
    }
  }

  async getAllQuotes(tokenIn, tokenOut, amountIn) {
    const quotes = [];
    for (const dex of DEXES) {
      try {
        let amountOut = ethers.BigNumber.from(0);
        let meta = {};

        if (dex.type === "v3") {
          // Check common fee tiers
          for (const fee of [500, 3000, 10000]) {
            const out = await this.quoteV3(dex, tokenIn, tokenOut, fee, amountIn);
            if (out.gt(amountOut)) {
              amountOut = out;
              meta = { fee };
            }
          }
        } else if (dex.type === "v2") {
          amountOut = await this.quoteV2(dex, tokenIn, tokenOut, amountIn);
        } else if (dex.type === "aerodrome") {
          // Check both stable and volatile
          for (const stable of [true, false]) {
            const out = await this.quoteAerodrome(dex, tokenIn, tokenOut, stable, amountIn);
            if (out.gt(amountOut)) {
              amountOut = out;
              meta = { stable };
            }
          }
        }

        if (amountOut.gt(0)) {
          quotes.push({ dex: dex.name, amountOut, meta, dexConfig: dex });
        }
      } catch (e) {
        // Skip failed quotes
      }
    }
    return quotes;
  }

  // Quote implementations (simplified for brevity)
  async quoteV3(dex, tokenIn, tokenOut, fee, amountIn) {
    const quoter = new ethers.Contract(dex.quoter, ["function quoteExactInputSingle(address,address,uint24,uint256,uint160) external returns (uint256)"], provider);
    try {
      return await quoter.callStatic.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0);
    } catch (e) { return ethers.BigNumber.from(0); }
  }

  async quoteV2(dex, tokenIn, tokenOut, amountIn) {
    const router = new ethers.Contract(dex.router, ["function getAmountsOut(uint256,address[]) external view returns (uint256[])"], provider);
    try {
      const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
      return amounts[1];
    } catch (e) { return ethers.BigNumber.from(0); }
  }

  async quoteAerodrome(dex, tokenIn, tokenOut, stable, amountIn) {
    const router = new ethers.Contract(dex.router, ["function getAmountsOut(uint256,(address,address,bool,address)[]) external view returns (uint256[])"], provider);
    try {
      const amounts = await router.getAmountsOut(amountIn, [{ from: tokenIn, to: tokenOut, stable, factory: dex.factory }]);
      return amounts[1];
    } catch (e) { return ethers.BigNumber.from(0); }
  }

  async executeDynamicArb(tokenA, tokenB, amountIn, buy, sell) {
    // This would call the enhanced contract with dynamic swap data
    console.log(`🚀 Executing: Buy ${tokenB} on ${buy.dex}, Sell on ${sell.dex}`);
    // Implementation of data encoding for the contract...
  }
}

const router = new DynamicRouter();
setInterval(() => router.findBestArb(), CONFIG.CHECK_INTERVAL_MS);
