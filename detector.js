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
    const pairsStr = process.env.TRADING_PAIRS || 'BTC:USDT:0x:0x,ETH:USDT:0x:0x';
    return pairsStr.split(',').map(pair => {
      const [base, quote, binanceAddr, mexcAddr] = pair.split(':');
      return {
        base: base.trim(),
        quote: quote.trim(),
        binanceAddr: binanceAddr?.trim() || null,
        mexcAddr: mexcAddr?.trim() || null,
        // For display purposes
        display: `${base.trim()}/${quote.trim()}`,
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

  // Fetch all exchange prices
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

  // Detect arbitrage opportunities
  detectArbitrage(prices) {
    const opportunities = [];

    this.monitoringPairs.forEach((pair) => {
      // Get the trading symbol (BTCUSDT format)
      const symbol = '' + pair.base + pair.quote;

      // Get prices from each exchange
      const binancePrice = prices.binance[symbol];
      const mexcPrice = prices.mexc[symbol];

      // Need prices from both exchanges
      if (!binancePrice || !mexcPrice) return;

      // Calculate profit percentage both ways
      const profitBinanceToMexc = ((mexcPrice - binancePrice) / binancePrice) * 100;
      const profitMexcToBinance = ((binancePrice - mexcPrice) / mexcPrice) * 100;

      // Check if profitable
      if (Math.abs(profitBinanceToMexc) > this.minProfitPercent) {
        opportunities.push({
          pair: pair.display,
          pairConfig: pair,
          buyExchange: profitBinanceToMexc > 0 ? 'binance' : 'mexc',
          sellExchange: profitBinanceToMexc > 0 ? 'mexc' : 'binance',
          buyPrice: profitBinanceToMexc > 0 ? binancePrice : mexcPrice,
          sellPrice: profitBinanceToMexc > 0 ? mexcPrice : binancePrice,
          profitPercent: Math.abs(profitBinanceToMexc),
          timestamp: new Date().toISOString(),
        });
      }
    });

    return opportunities;
  }

  // Display prices from all exchanges for verification
  displayPrices(prices) {
    console.log('\n[' + new Date().toISOString() + '] Current Prices:');
    console.log('-'.repeat(80));

    this.monitoringPairs.forEach((pair) => {
      const symbol = '' + pair.base + pair.quote;

      console.log('\n' + pair.display + ':');
      console.log('  Binance Addr: ' + (pair.binanceAddr || 'N/A'));
      console.log('  MEXC Addr:    ' + (pair.mexcAddr || 'N/A'));

      const binancePrice = prices.binance[symbol];
      const mexcPrice = prices.mexc[symbol];

      const binancePriceStr = binancePrice ? '$' + parseFloat(binancePrice).toFixed(8) : 'NOT FOUND';
      const mexcPriceStr = mexcPrice ? '$' + parseFloat(mexcPrice).toFixed(8) : 'NOT FOUND';

      console.log('  binance  -> ' + binancePriceStr);
      console.log('  mexc     -> ' + mexcPriceStr);
    });

    console.log('\n' + '='.repeat(80) + '\n');
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
