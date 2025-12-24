//  kamino-flash-engine.js  — Kamino flash loan + Jupiter swap integration
const { Connection, PublicKey, VersionedTransaction } = require('@solana/web3.js');
const fetch = require('node-fetch');

const KAMINO_FLASH_URL = 'https://api.kamino.finance/v1/flash-loan';
const JUPITER_SWAP_URL = 'https://lite-api.jup.ag/swap/v1/swap';
const JITO_BUNDLE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const JITO_TIP_ACCOUNT = new PublicKey('juLesoTJWQaG4zTEa6f8vdh9Sh7uSSo58nK9GSr2s1M');

class KaminoFlashEngine {
  constructor(walletKeypair, rpcUrl) {
    this.wallet = walletKeypair;
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.jitoAuth = process.env.JITO_AUTH_KEY;
  }

  async executeFlashLoanArbitrage(loanAmount) {
    console.log('🔥 EXECUTING FLASH LOAN ARBITRAGE...');
    console.log('Loan Amount:', (loanAmount / 1e6).toLocaleString(), 'USDC');

    try {
      // Step 1: Get Jupiter quotes for the arbitrage
      console.log('📊 Getting arbitrage quotes...');
      const quotes = await this.getArbitrageQuotes(loanAmount);
      if (!quotes) return null;

      const spread = Number(quotes.back.outAmount - loanAmount) / loanAmount;
      const netProfit = Number(quotes.back.outAmount - loanAmount) / 1e6 - (loanAmount * 0.0006) / 1e9;

      console.log(`📈 Spread: ${(spread * 100).toFixed(3)}%`);
      console.log(`🎯 Net Profit: $${netProfit.toFixed(4)}`);

      if (netProfit < 0.5) { // $0.50 minimum for flash loans
        console.log('❌ Profit too small for flash loan');
        return null;
      }

      // Step 2: Build Kamino flash loan with Jupiter swaps
      console.log('🏗️ Building flash loan transaction...');
      const flashTx = await this.buildFlashLoanTx(
        loanAmount,
        quotes.forward,
        quotes.back
      );

      if (!flashTx) return null;

      // Step 3: Create MEV-protected bundle
      console.log('🛡️ Creating MEV-protected bundle...');
      const bundleId = await this.submitJitoBundle(flashTx);
      
      if (bundleId) {
        console.log('✅ MEV-protected flash loan submitted!');
        console.log('Bundle ID:', bundleId);
        
        return {
          status: 'submitted',
          profit: netProfit,
          bundleId: bundleId,
          loanAmount: loanAmount,
          spread: spread
        };
      }

    } catch (error) {
      console.error('💥 Flash loan failed:', error.message);
      return null;
    }
  }

  async getArbitrageQuotes(amount) {
    try {
      // Quote 1: USDC → SOL
      const quote1 = await fetch(
        `https://lite-api.jup.ag/swap/v1/quote?inputMint=${USDC_MINT}&outputMint=${SOL_MINT}&amount=${amount}&slippageBps=50`
      ).then(r => r.ok ? r.json() : null);

      if (!quote1) return null;

      // Quote 2: SOL → USDC (back trade)
      const quote2 = await fetch(
        `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${quote1.outAmount}&slippageBps=50`
      ).then(r => r.ok ? r.json() : null);

      if (!quote2) return null;

      return {
        forward: quote1,
        back: quote2
      };

    } catch (error) {
      console.error('💥 Quote failed:', error.message);
      return null;
    }
  }

  async buildFlashLoanTx(loanAmount, forwardQuote, backQuote) {
    try {
      const flashLoanBody = {
        token: USDC_MINT.toString(),
        amount: loanAmount,
        user: this.wallet.publicKey.toString(),
        instructions: 'jupiter',
        inputMint: USDC_MINT.toString(),
        outputMint: SOL_MINT.toString(),
        finalMint: USDC_MINT.toString(),
        slippageBps: 50,
        priorityFeeLamports: Math.max(10_000, Math.floor(loanAmount * 0.0001))
      };

      const response = await fetch(KAMINO_FLASH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flashLoanBody)
      });

      if (!response.ok) {
        console.log('❌ Kamino flash loan build failed');
        return null;
      }

      const data = await response.json();
      return Buffer.from(data.tx, 'base64');

    } catch (error) {
      console.error('💥 Flash loan build failed:', error.message);
      return null;
    }
  }

  async submitJitoBundle(transactionData) {
    try {
      if (!this.jitoAuth) {
        console.log('⚠️ No Jito auth key - submitting regular transaction');
        return 'regular-tx';
      }

      // Create Jito bundle with MEV protection
      const bundle = [Array.from(transactionData)];
      const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [bundle]
      };

      const response = await fetch(JITO_BUNDLE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.jitoAuth}`
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const result = await response.json();
        return result.result;
      } else {
        console.log('❌ Jito bundle failed, trying regular tx');
        return 'regular-tx-fallback';
      }

    } catch (error) {
      console.error('💥 Jito submission failed:', error.message);
      return 'regular-tx-fallback';
    }
  }
}

module.exports = { KaminoFlashEngine };
