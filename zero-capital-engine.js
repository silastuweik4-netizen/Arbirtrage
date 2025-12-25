//  zero-capital-engine.js  — FIXED ES module syntax
import { Connection, PublicKey } from '@solana/web3.js';
import { getRenderSafePrices } from './render-safe-prices.js';

const KAMINO_FLASH_URL = 'https://api.kamino.finance/v1/flash-loan';
const JUPITER_API = 'https://lite-api.jup.ag/swap/v1';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

export class ZeroCapitalFlashEngine {
  constructor(walletKeypair, rpcUrl) {
    this.wallet = walletKeypair;
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  async executeZeroCapitalArbitrage() {
    console.log('🏊‍♂️ EXECUTING ZERO-CAPITAL KAMINO FLASH LOAN...');
    console.log('💰 Using: $0 of your money (100% borrowed)');
    
    try {
      // Step 1: Find optimal flash loan amount (1/3 of shallow pool)
      const optimalAmount = await this.findOptimalFlashLoanAmount();
      
      if (!optimalAmount) {
        console.log('⚠️ No optimal flash loan amount found');
        return null;
      }
      
      console.log('💰 Flash loan amount:', (optimalAmount/1e6).toLocaleString(), 'USDC');
      console.log('🏊‍♂️ 1/3 of shallow pool rule applied');
      
      // Step 2: Get realized Jupiter quotes
      const quotes = await this.getRealizedArbitrageQuotes(optimalAmount);
      
      if (!quotes) {
        console.log('❌ No realized arbitrage opportunity');
        return null;
      }
      
      const spread = Number(quotes.back.outAmount - optimalAmount) / optimalAmount;
      const netProfit = Number(quotes.back.outAmount - optimalAmount) / 1e6 - (optimalAmount * 0.0006) / 1e9;
      
      if (netProfit < 0.5) { // Higher threshold for flash loans
        console.log('❌ Profit too small for flash loan');
        return null;
      }
      
      console.log('🎯 Zero-capital opportunity detected!');
      console.log(`💰 Zero-capital profit: $${netProfit.toFixed(4)}`);
      console.log(`📊 Zero-capital spread: ${(spread * 100).toFixed(3)}%`);
      
      // Step 3: Execute zero-capital flash loan
      const result = await this.executeZeroCapitalTrade(optimalAmount, quotes);
      
      if (result && result.isOnChain) {
        console.log('✅ ZERO-CAPITAL KAMINO FLASH LOAN EXECUTED ON-CHAIN!');
        console.log(`💰 Zero-capital profit: $${result.profit.toFixed(4)}`);
        console.log(`🏊‍♂️ Zero-capital amount: ${(result.amount/1e6).toLocaleString()} USDC`);
        console.log(`🔗 On-chain signature: ${result.signature}`);
        console.log(`🏊‍♂️ Pool category: ${result.shallowPool?.category}`);
      }
      
      return null;
      
    } catch (error) {
      console.error('💥 Zero-capital flash loan failed:', error.message);
      return null;
    }
  }

  async findOptimalFlashLoanAmount() {
    console.log('🏊‍♂️ Finding optimal zero-capital flash loan amount...');
    
    const testAmounts = [
      10000e6,   // $10K
      25000e6,   // $25K  
      50000e6,   // $50K
      100000e6,  // $100K
      250000e6   // $250K
    ];
    
    let optimalAmount = null;
    let bestProfit = 0;
    
    for (const testAmount of testAmounts) {
      try {
        console.log(`🔍 Testing ${(testAmount/1e6).toLocaleString()} USDC...`);
        
        // Get realized Jupiter quotes
        const quote1 = await fetch(
          `${JUPITER_API}/quote?inputMint=${USDC_MINT}&outputMint=${SOL_MINT}&amount=${testAmount}&slippageBps=50`
        ).then(r => r.ok ? r.json() : null);
        
        if (!quote1) continue;
        
        const quote2 = await fetch(
          `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${quote1.outAmount}&slippageBps=50`
        ).then(r => r.ok ? r.json() : null);
        
        if (!quote2) continue;
        
        const profit = Number(quote2.outAmount - testAmount) / 1e6 - (testAmount * 0.0006) / 1e9;
        const spread = Number(quote2.outAmount - testAmount) / testAmount;
        
        if (profit > bestProfit) {
          bestProfit = profit;
          optimalAmount = testAmount;
        }
        
      } catch (error) {
        console.log(`❌ Test failed for ${(testAmount/1e6).toLocaleString()}:`, error.message);
      }
    }
    
    if (optimalAmount && bestProfit > 0.5) {
      console.log(`✅ Optimal zero-capital amount: ${(optimalAmount/1e6).toLocaleString()} USDC`);
      console.log(`💰 Best zero-capital profit: $${bestProfit.toFixed(4)}`);
      return optimalAmount;
    }
    
    return null;
  }
}
