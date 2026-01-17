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
  gateio: {
    name: 'Gate.io',
    tickerUrl: 'https://api.gateio.ws/api/v4/spot/tickers',
    minNotional: 10,
  },
  bybit: {
    name: 'Bybit',
    tickerUrl: 'https://api.bybit.com/v5/market/tickers?category=spot',
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
    const pairsStr = process.env.TRADING_PAIRS || 'BTC:USDT:0x:0x:0x:0x,ETH:USDT:0x:0x:0x:0x';
    return pairsStr.split(',').map(pair => {
      const [base, quote, binanceAddr, mexcAddr, gateioAddr, bybitAddr] = pair.split(':');
      return {
        base: base.trim(),
        quote: quote.trim(),
        binanceAddr: binanceAddr?.trim() || null,
        mexcAddr: mexcAddr?.trim() || null,
        gateioAddr: gateioAddr?.trim() || null,
        bybitAddr: bybitAddr?.trim() || null,
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

  // Fetch prices from Gate.io
  async fetchGateio() {
    try {
      const response = await axios.get(exchanges.gateio.tickerUrl, {
        timeout: 5000,
      });
      const prices = {};
      response.data.forEach((ticker) => {
        prices[ticker.symbol] = parseFloat(ticker.last);
      });
      return prices;
    } catch (error) {
      console.error('Gate.io fetch error: ' + error.message);
      return {};
    }
  }

  // Fetch prices from Bybit
  async fetchBybit() {
    try {
      const response = await axios.get(exchanges.bybit.tickerUrl, {
        timeout: 5000,
      });
      const prices = {};
      response.data.result.list.forEach((ticker) => {
        prices[ticker.symbol] = parseFloat(ticker.lastPrice);
      });
      return prices;
    } catch (error) {
      console.error('Bybit fetch error: ' + error.message);
      return {};
    }
  }

  // Fetch all exchange prices
  async fetchAllPrices() {
    const [binance, mexc, gateio, bybit] = await Promise.all([
      this.fetchBinance(),
      this.fetchMexc(),
      this.fetchGateio(),
      this.fetchBybit(),
    ]);

    return {
      binance,
      mexc,
      gateio,
      bybit,
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
      const gateioPrice = prices.gateio[symbol];
      const bybitPrice = prices.bybit[symbol];

      // Build exchange prices object with available prices
      const exchangePrices = {};
      if (binancePrice) exchangePrices.binance = binancePrice;
      if (mexcPrice) exchangePrices.mexc = mexcPrice;
      if (gateioPrice) exchangePrices.gateio = gateioPrice;
      if (bybitPrice) exchangePrices.bybit = bybitPrice;

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
      const symbol = '' + pair.base + pair.quote;

      console.log('\n' + pair.display + ':');
      console.log('  Addrs: B=' + (pair.binanceAddr ? pair.binanceAddr.substring(0, 8) + '...' : 'N/A') + ' M=' + (pair.mexcAddr ? pair.mexcAddr.substring(0, 8) + '...' : 'N/A') + ' G=' + (pair.gateioAddr ? pair.gateioAddr.substring(0, 8) + '...' : 'N/A') + ' By=' + (pair.bybitAddr ? pair.bybitAddr.substring(0, 8) + '...' : 'N/A'));

      const binancePrice = prices.binance[symbol];
      const mexcPrice = prices.mexc[symbol];
      const gateioPrice = prices.gateio[symbol];
      const bybitPrice = prices.bybit[symbol];

      const binancePriceStr = binancePrice ? '

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
    console.log('Exchanges: Binance, MEXC, Gate.io, Bybit');
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

  // For server API - fetch prices on demand
  async fetchAllPrices() {
    const [binance, mexc] = await Promise.all([
      this.fetchBinance(),
      this.fetchMexc(),
    ]);

    return {
      binance,
      mexc,
    };
  }
}

// Initialize detector
const detector = new ArbitrageDetector();

// Export for server integration
export default detector; + parseFloat(binancePrice).toFixed(8) : 'N/A';
      const mexcPriceStr = mexcPrice ? '

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
    console.log('Monitoring pairs:');
    this.monitoringPairs.forEach(p => {
      console.log('  ' + p.display);
      console.log('    Binance: ' + (p.binanceAddr || 'default'));
      console.log('    MEXC:    ' + (p.mexcAddr || 'default'));
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

  // For server API - fetch prices on demand
  async fetchAllPrices() {
    const [binance, mexc] = await Promise.all([
      this.fetchBinance(),
      this.fetchMexc(),
    ]);

    return {
      binance,
      mexc,
    };
  }
}

// Initialize detector
const detector = new ArbitrageDetector();

// Export for server integration
export default detector; + parseFloat(mexcPrice).toFixed(8) : 'N/A';
      const gatioPriceStr = gateioPrice ? '

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
    console.log('Monitoring pairs:');
    this.monitoringPairs.forEach(p => {
      console.log('  ' + p.display);
      console.log('    Binance: ' + (p.binanceAddr || 'default'));
      console.log('    MEXC:    ' + (p.mexcAddr || 'default'));
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

  // For server API - fetch prices on demand
  async fetchAllPrices() {
    const [binance, mexc] = await Promise.all([
      this.fetchBinance(),
      this.fetchMexc(),
    ]);

    return {
      binance,
      mexc,
    };
  }
}

// Initialize detector
const detector = new ArbitrageDetector();

// Export for server integration
export default detector; + parseFloat(gateioPrice).toFixed(8) : 'N/A';
      const bybitPriceStr = bybitPrice ? '

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
    console.log('Monitoring pairs:');
    this.monitoringPairs.forEach(p => {
      console.log('  ' + p.display);
      console.log('    Binance: ' + (p.binanceAddr || 'default'));
      console.log('    MEXC:    ' + (p.mexcAddr || 'default'));
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

  // For server API - fetch prices on demand
  async fetchAllPrices() {
    const [binance, mexc] = await Promise.all([
      this.fetchBinance(),
      this.fetchMexc(),
    ]);

    return {
      binance,
      mexc,
    };
  }
}

// Initialize detector
const detector = new ArbitrageDetector();

// Export for server integration
export default detector; + parseFloat(bybitPrice).toFixed(8) : 'N/A';

      console.log('  binance  -> ' + binancePriceStr);
      console.log('  mexc     -> ' + mexcPriceStr);
      console.log('  gateio   -> ' + gatioPriceStr);
      console.log('  bybit    -> ' + bybitPriceStr);
    });

    console.log('\n' + '='.repeat(100) + '\n');
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
    console.log('Monitoring pairs:');
    this.monitoringPairs.forEach(p => {
      console.log('  ' + p.display);
      console.log('    Binance: ' + (p.binanceAddr || 'default'));
      console.log('    MEXC:    ' + (p.mexcAddr || 'default'));
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

  // For server API - fetch prices on demand
  async fetchAllPrices() {
    const [binance, mexc] = await Promise.all([
      this.fetchBinance(),
      this.fetchMexc(),
    ]);

    return {
      binance,
      mexc,
    };
  }
}

// Initialize detector
const detector = new ArbitrageDetector();

// Export for server integration
export default detector;
