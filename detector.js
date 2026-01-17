import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Exchange configurations
const exchanges = {
  binance: {
    name: 'Binance',
    tickerUrl: 'https://api.binance.com/api/v3/ticker/price',
    minNotional: 10, // USD
  },
  mexc: {
    name: 'MEXC',
    tickerUrl: 'https://api.mexc.com/api/v3/ticker/price',
    minNotional: 10, // USDT
  },
  kucoin: {
    name: 'KuCoin',
    tickerUrl: 'https://api.spot.kucoin.com/api/v3/allTickers',
    parseMethod: 'kucoin',
    minNotional: 10, // USDT
  },
};

class ArbitrageDetector {
  constructor() {
    this.prices = {};
    this.opportunities = [];
    this.minProfitPercent = parseFloat(process.env.MIN_PROFIT_PERCENT) || 1.5;
    this.monitoringPairs = (process.env.TRADING_PAIRS || 'BTC/USDT,ETH/USDT').split(',');
    this.fetchInterval = parseInt(process.env.FETCH_INTERVAL_MS) || 10000; // 10 seconds
  }

  // Normalize pair format (e.g., BTC/USDT -> BTCUSDT)
  normalizePair(pair) {
    return pair.replace('/', '');
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
      console.error(`Binance fetch error: ${error.message}`);
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
      console.error(`MEXC fetch error: ${error.message}`);
      return {};
    }
  }

  // Fetch prices from KuCoin
  async fetchKucoin() {
    try {
      // Use alternative KuCoin endpoint
      const response = await axios.get('https://api.kucoin.com/api/v1/market/allTickers', {
        timeout: 5000,
      });
      const prices = {};
      response.data.data.ticker.forEach((ticker) => {
        prices[ticker.symbol] = parseFloat(ticker.last);
      });
      return prices;
    } catch (error) {
      console.error(`KuCoin fetch error: ${error.message}`);
      return {};
    }
  }

  // Fetch all exchange prices
  async fetchAllPrices() {
    const [binance, mexc, kucoin] = await Promise.all([
      this.fetchBinance(),
      this.fetchMexc(),
      this.fetchKucoin(),
    ]);

    return {
      binance,
      mexc,
      kucoin,
    };
  }

  // Detect arbitrage opportunities
  detectArbitrage(prices) {
    const opportunities = [];
    const exchangeNames = Object.keys(prices);

    // Compare each pair across all exchanges
    this.monitoringPairs.forEach((pair) => {
      const normalizedPair = this.normalizePair(pair);

      // Get prices from each exchange
      const exchangePrices = {};
      exchangeNames.forEach((ex) => {
        if (prices[ex][normalizedPair]) {
          exchangePrices[ex] = prices[ex][normalizedPair];
        }
      });

      // Need at least 2 exchanges with this pair
      if (Object.keys(exchangePrices).length < 2) return;

      // Check all pairs of exchanges
      const exList = Object.keys(exchangePrices);
      for (let i = 0; i < exList.length; i++) {
        for (let j = i + 1; j < exList.length; j++) {
          const ex1 = exList[i];
          const ex2 = exList[j];
          const price1 = exchangePrices[ex1];
          const price2 = exchangePrices[ex2];

          // Calculate profit percentage both ways
          const profit1to2 = ((price2 - price1) / price1) * 100; // Buy on ex1, sell on ex2
          const profit2to1 = ((price1 - price2) / price2) * 100; // Buy on ex2, sell on ex1

          // Check if profitable
          if (Math.abs(profit1to2) > this.minProfitPercent) {
            opportunities.push({
              pair,
              buyExchange: profit1to2 > 0 ? ex1 : ex2,
              sellExchange: profit1to2 > 0 ? ex2 : ex1,
              buyPrice: profit1to2 > 0 ? price1 : price2,
              sellPrice: profit1to2 > 0 ? price2 : price1,
              profitPercent: Math.abs(profit1to2),
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    });

    return opportunities;
  }

  // Format and log opportunities
  displayOpportunities(opps) {
    if (opps.length === 0) {
      console.log(`[${new Date().toISOString()}] No opportunities found`);
      return;
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`Found ${opps.length} arbitrage opportunity(ies) at ${new Date().toISOString()}`);
    console.log('='.repeat(80));

    opps.forEach((opp, idx) => {
      console.log(`\n[${idx + 1}] ${opp.pair}`);
      console.log(`  Buy on:  ${opp.buyExchange.toUpperCase()} @ $${opp.buyPrice.toFixed(8)}`);
      console.log(`  Sell on: ${opp.sellExchange.toUpperCase()} @ $${opp.sellPrice.toFixed(8)}`);
      console.log(`  Profit:  ${opp.profitPercent.toFixed(2)}%`);
      console.log(`  Spread:  $${(opp.sellPrice - opp.buyPrice).toFixed(8)}`);
    });

    console.log(`\n${'='.repeat(80)}\n`);
  }

  // Main detection loop
  async start() {
    console.log('🤖 CEX Arbitrage Detector Started');
    console.log(`📊 Monitoring pairs: ${this.monitoringPairs.join(', ')}`);
    console.log(`💰 Minimum profit threshold: ${this.minProfitPercent}%`);
    console.log(`⏱️  Update interval: ${this.fetchInterval}ms\n`);

    // Initial fetch
    await this.updatePrices();

    // Periodic updates
    setInterval(() => this.updatePrices(), this.fetchInterval);
  }

  async updatePrices() {
    try {
      const prices = await this.fetchAllPrices();
      const opportunities = this.detectArbitrage(prices);

      if (opportunities.length > 0) {
        this.opportunities = opportunities;
        this.displayOpportunities(opportunities);

        // Emit event or webhook (you can add this later)
        // await this.notifyWebhook(opportunities);
      }
    } catch (error) {
      console.error(`Update error: ${error.message}`);
    }
  }

  // Get current opportunities (for API endpoint)
  getOpportunities() {
    return this.opportunities;
  }
}

// Initialize detector
const detector = new ArbitrageDetector();

// Export for server integration
export default detector;

// Start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  detector.start();
}
