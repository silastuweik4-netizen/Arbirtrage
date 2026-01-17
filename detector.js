import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Exchange configurations
const exchanges = {
  binance: {
    name: 'Binance',
    tickerUrl: 'https://api.binance.com/api/v3/ticker/price',
    minNotional: 10,
  },
  mexc: {
    name: 'MEXC',
    tickerUrl: 'https://api.mexc.com/api/v3/ticker/price',
    minNotional: 10,
  },
  deepcoin: {
    name: 'Deepcoin',
    tickerUrl: 'https://api.deepcoin.com/v1/market/tickers',
    minNotional: 10,
  },
};

class ArbitrageDetector {
  constructor() {
    this.prices = {};
    this.opportunities = [];
    this.minProfitPercent = parseFloat(process.env.MIN_PROFIT_PERCENT) || 1.5;
    
    // Parse trading pairs with contract addresses
    // Format: "BTC:USDT:contract_addr1:contract_addr2"
    this.monitoringPairs = this.parseMonitoringPairs();
    this.fetchInterval = parseInt(process.env.FETCH_INTERVAL_MS) || 10000;
  }

  // Parse monitoring pairs from env
  parseMonitoringPairs() {
    const pairsStr = process.env.TRADING_PAIRS || 'BTC:USDT:0x:0x:0x,ETH:USDT:0x:0x:0x';
    return pairsStr.split(',').map(pair => {
      const [base, quote, binanceAddr, mexcAddr, deepcoinAddr] = pair.split(':');
      return {
        base: base.trim(),
        quote: quote.trim(),
        binanceAddr: binanceAddr?.trim() || null,
        mexcAddr: mexcAddr?.trim() || null,
        deepcoinAddr: deepcoinAddr?.trim() || null,
        display: base.trim() + '/' + quote.trim(),
      };
    });
  }

  // Fetch prices from Binance
  async fetchBinance() {
    try {
      const response = await axios.get(exchanges.binance.tickerUrl, {
        timeout: 5000,
      });
      const prices = {};
      response.data.forEach((ticker) => {
        prices[ticker.symbol] = parseFloat(ticker.price);
      });
      return prices;
    } catch (error) {
      console.error('Binance fetch error: ' + error.message);
      return {};
    }
  }

  // Fetch prices from MEXC
  async fetchMexc() {
    try {
      const response = await axios.get(exchanges.mexc.tickerUrl, {
        timeout: 5000,
      });
      const prices = {};
      response.data.forEach((ticker) => {
        prices[ticker.symbol] = parseFloat(ticker.price);
      });
      return prices;
    } catch (error) {
      console.error('MEXC fetch error: ' + error.message);
      return {};
    }
  }

  // Fetch prices from Deepcoin
  async fetchDeepcoin() {
    try {
      const response = await axios.get(exchanges.deepcoin.tickerUrl, {
        timeout: 5000,
      });
      const prices = {};
      response.data.forEach((ticker) => {
        prices[ticker.symbol] = parseFloat(ticker.last);
      });
      return prices;
    } catch (error) {
      console.error('Deepcoin fetch error: ' + error.message);
      return {};
    }
  }

  // Fetch all exchange prices
  async fetchAllPrices() {
    const [binance, mexc, deepcoin] = await Promise.all([
      this.fetchBinance(),
      this.fetchMexc(),
      this.fetchDeepcoin(),
    ]);

    return {
      binance,
      mexc,
      deepcoin,
    };
  }

  // Detect arbitrage opportunities
  detectArbitrage(prices) {
    const opportunities = [];

    this.monitoringPairs.forEach((pair) => {
      const symbol = pair.base + pair.quote;

      // Get prices from all exchanges
      const binancePrice = prices.binance[symbol];
      const mexcPrice = prices.mexc[symbol];
      const deepcoinPrice = prices.deepcoin[symbol];

      // Build exchange prices object with available prices
      const exchangePrices = {};
      if (binancePrice) exchangePrices.binance = binancePrice;
      if (mexcPrice) exchangePrices.mexc = mexcPrice;
      if (deepcoinPrice) exchangePrices.deepcoin = deepcoinPrice;

      // Need at least 2 exchanges with this pair
      if (Object.keys(exchangePrices).length < 2) return;

      // Compare all pairs of exchanges
      const exList = Object.keys(exchangePrices);
      for (let i = 0; i < exList.length; i++) {
        for (let j = i + 1; j < exList.length; j++) {
          const ex1 = exList[i];
          const ex2 = exList[j];
          const price1 = exchangePrices[ex1];
          const price2 = exchangePrices[ex2];

          // Calculate profit percentage
          const profit = ((price2 - price1) / price1) * 100;

          // Check if profitable
          if (Math.abs(profit) > this.minProfitPercent) {
            opportunities.push({
              pair: pair.display,
              pairConfig: pair,
              buyExchange: profit > 0 ? ex1 : ex2,
              sellExchange: profit > 0 ? ex2 : ex1,
              buyPrice: profit > 0 ? price1 : price2,
              sellPrice: profit > 0 ? price2 : price1,
              profitPercent: Math.abs(profit),
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    });

    return opportunities;
  }

  // Display prices from all exchanges for verification
  displayPrices(prices) {
    console.log('\n[' + new Date().toISOString() + '] Current Prices:');
    console.log('-'.repeat(100));

    this.monitoringPairs.forEach((pair) => {
      const symbol = pair.base + pair.quote; // Corrected symbol creation

      console.log('\n' + pair.display + ':');
      // Updated addresses to match available data fields
      console.log('  Addrs: B=' + (pair.binanceAddr ? pair.binanceAddr.substring(0, 8) + '...' : 'N/A') + ' M=' + (pair.mexcAddr ? pair.mexcAddr.substring(0, 8) + '...' : 'N/A') + ' D=' + (pair.deepcoinAddr ? pair.deepcoinAddr.substring(0, 8) + '...' : 'N/A'));

      const binancePrice = prices.binance[symbol];
      const mexcPrice = prices.mexc[symbol];
      const deepcoinPrice = prices.deepcoin[symbol]; // Corrected exchange name

      // *** FIX APPLIED HERE ***
      const binancePriceStr = binancePrice ? 'Binance: $' + parseFloat(binancePrice).toFixed(8) : 'Binance: N/A';
      const mexcPriceStr = mexcPrice ? 'MEXC: $' + parseFloat(mexcPrice).toFixed(8) : 'MEXC: N/A';
      const deepcoinPriceStr = deepcoinPrice ? 'Deepcoin: $' + parseFloat(deepcoinPrice).toFixed(8) : 'Deepcoin: N/A';

      console.log('  ' + binancePriceStr + ' | ' + mexcPriceStr + ' | ' + deepcoinPriceStr);
    });
  }

  // Format and log opportunities
  displayOpportunities(opps) {
    if (opps.length === 0) {
      return;
    }

    console.log('\n' + '='.repeat(80));
    console.log('FOUND ' + opps.length + ' ARBITRAGE OPPORTUNITY(IES) at ' + new Date().toISOString());
    console.log('='.repeat(80));

    opps.forEach((opp, idx) => {
      console.log('\n[' + (idx + 1) + '] ' + opp.pair);
      console.log('  Binance Addr: ' + (opp.pairConfig.binanceAddr || 'N/A'));
      console.log('  MEXC Addr:    ' + (opp.pairConfig.mexcAddr || 'N/A'));
      console.log('  Deepcoin Addr: ' + (opp.pairConfig.deepcoinAddr || 'N/A')); // Added Deepcoin Addr
      console.log('  Buy on:  ' + opp.buyExchange.toUpperCase() + ' @ $' + opp.buyPrice.toFixed(8));
      console.log('  Sell on: ' + opp.sellExchange.toUpperCase() + ' @ $' + opp.sellPrice.toFixed(8));
      console.log('  Profit:  ' + opp.profitPercent.toFixed(2) + '%');
      console.log('  Spread:  $' + (opp.sellPrice - opp.buyPrice).toFixed(8));
    });

    console.log('\n' + '='.repeat(80) + '\n');
  }

  // Main detection loop
  async start() {
    console.log('CEX Arbitrage Detector Started');
    console.log('Exchanges: Binance, MEXC, Deepcoin');
    console.log('Monitoring pairs:');
    this.monitoringPairs.forEach(p => {
      console.log('  ' + p.display);
    });
    console.log('Minimum profit threshold: ' + this.minProfitPercent + '%');
    console.log('Update interval: ' + this.fetchInterval + 'ms\n');

    // Initial fetch
    await this.updatePrices();

    // Periodic updates
    setInterval(() => this.updatePrices(), this.fetchInterval);
  }

  async updatePrices() {
    try {
      const prices = await this.fetchAllPrices();
      this.displayPrices(prices);
      const opportunities = this.detectArbitrage(prices);

      if (opportunities.length > 0) {
        this.opportunities = opportunities;
        this.displayOpportunities(opportunities);
      }
    } catch (error) {
      console.error('Update error: ' + error.message);
    }
  }

  // Get current opportunities (for API endpoint)
  getOpportunities() {
    return this.opportunities;
  }

  // Note: There was a duplicate fetchAllPrices method at the bottom of your original code. 
  // I have removed the duplicate and kept the comprehensive one at the top.
}

// Initialize detector
const detector = new ArbitrageDetector();

// Export for server integration
export default detector;
