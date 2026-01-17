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
  kucoin: {
    name: 'KuCoin',
    tickerUrl: 'https://api.kucoin.com/api/v1/market/allTickers',
    minNotional: 10,
  },
};

class ArbitrageDetector {
  constructor() {
    this.prices = {};
    this.opportunities = [];
    this.minProfitPercent = parseFloat(process.env.MIN_PROFIT_PERCENT) || 1.5;
    
    // Parse trading pairs with contract addresses
    // Format: "BTC:USDT:contract_addr1:contract_addr2:contract_addr3"
    this.monitoringPairs = this.parseMonitoringPairs();
    this.fetchInterval = parseInt(process.env.FETCH_INTERVAL_MS) || 10000;
  }

  // Parse monitoring pairs from env
  parseMonitoringPairs() {
    const pairsStr = process.env.TRADING_PAIRS || 'BTC:USDT:0x:0x:0x,ETH:USDT:0x:0x:0x';
    return pairsStr.split(',').map(pair => {
      const [base, quote, binanceAddr, mexcAddr, kucoinAddr] = pair.split(':');
      return {
        base: base.trim(),
        quote: quote.trim(),
        binanceAddr: binanceAddr?.trim() || null,
        mexcAddr: mexcAddr?.trim() || null,
        kucoinAddr: kucoinAddr?.trim() || null,
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
      const response = await axios.get(exchanges.kucoin.tickerUrl, {
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

  // Get trading pair symbol by contract address and exchange
  getTradingSymbol(pair, exchange) {
    const addrKey = `${exchange}Addr`;
    const contractAddr = pair[addrKey];
    
    if (!contractAddr) {
      // Fallback to ticker name if no address provided
      return `${pair.base}${pair.quote}`;
    }
    
    return `${pair.base}${pair.quote}`;
  }

  // Detect arbitrage opportunities
  detectArbitrage(prices) {
    const opportunities = [];
    const exchangeNames = Object.keys(prices);

    this.monitoringPairs.forEach((pair) => {
      // Get the trading symbol for each exchange
      const binanceSymbol = `${pair.base}${pair.quote}`;
      const mexcSymbol = `${pair.base}${pair.quote}`;
      const kucoinSymbol = `${pair.base}${pair.quote}`;

      // Get prices from each exchange
      const exchangePrices = {
        binance: prices.binance[binanceSymbol],
        mexc: prices.mexc[mexcSymbol],
        kucoin: prices.kucoin[kucoinSymbol],
      };

      // Filter out undefined prices
      const validExchanges = {};
      Object.entries(exchangePrices).forEach(([ex, price]) => {
        if (price !== undefined && price > 0) {
          validExchanges[ex] = price;
        }
      });

      // Need at least 2 exchanges with this pair
      if (Object.keys(validExchanges).length < 2) return;

      // Check all pairs of exchanges
      const exList = Object.keys(validExchanges);
      for (let i = 0; i < exList.length; i++) {
        for (let j = i + 1; j < exList.length; j++) {
          const ex1 = exList[i];
          const ex2 = exList[j];
          const price1 = validExchanges[ex1];
          const price2 = validExchanges[ex2];

          // Calculate profit percentage both ways
          const profit1to2 = ((price2 - price1) / price1) * 100;
          const profit2to1 = ((price1 - price2) / price2) * 100;

          // Check if profitable
          if (Math.abs(profit1to2) > this.minProfitPercent) {
            opportunities.push({
              pair: pair.display,
              pairConfig: pair,
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

  // Display prices from all exchanges for verification
  displayPrices(prices) {
    console.log(`\n[${new Date().toISOString()}] Current Prices:`);
    console.log('-'.repeat(120));

    this.monitoringPairs.forEach((pair) => {
      const binanceSymbol = `${pair.base}${pair.quote}`;
      const mexcSymbol = `${pair.base}${pair.quote}`;
      const kucoinSymbol = `${pair.base}${pair.quote}`;

      console.log(`\n${pair.display}:`);
      console.log(`  Base: ${pair.base} | Quote: ${pair.quote}`);
      console.log(`  Binance Addr:  ${pair.binanceAddr || 'N/A'}`);
      console.log(`  MEXC Addr:     ${pair.mexcAddr || 'N/A'}`);
      console.log(`  KuCoin Addr:   ${pair.kucoinAddr || 'N/A'}`);
      console.log(`  Prices:`);

      const binancePrice = prices.binance[binanceSymbol];
      const mexcPrice = prices.mexc[mexcSymbol];
      const kucoinPrice = prices.kucoin[kucoinSymbol];

      console.log(
        `    binance  → ${binancePrice ? '$' + parseFloat(binancePrice).toFixed(8) : '❌ NOT FOUND'}`
      );
      console.log(
        `    mexc     → ${mexcPrice ? '$' + parseFloat(mexcPrice).toFixed(8) : '❌ NOT FOUND'}`
      );
      console.log(
        `    kucoin   → ${kucoinPrice ? '$' + parseFloat(kucoinPrice).toFixed(8) : '❌ NOT FOUND'}`
      );
    });

    console.log(`\n${'='.repeat(120)}\n`);
  }

  // Format and log opportunities
  displayOpportunities(opps) {
    if (opps.length === 0) {
      return;
    }

    console.log(`\n${'='.repeat(120)}`);
    console.log(`🎯 Found ${opps.length} arbitrage opportunity(ies) at ${new Date().toISOString()}`);
    console.log('='.repeat(120));

    opps.forEach((opp, idx) => {
      console.log(`\n[${idx + 1}] ${opp.pair}`);
      console.log(`  Contract Address:`);
      console.log(`    ${opp.pairConfig.binanceAddr ? '✓ Binance: ' + opp.pairConfig.binanceAddr : '  Binance: N/A'}`);
      console.log(`    ${opp.pairConfig.mexcAddr ? '✓ MEXC: ' + opp.pairConfig.mexcAddr : '  MEXC: N/A'}`);
      console.log(`    ${opp.pairConfig.kucoinAddr ? '✓ KuCoin: ' + opp.pairConfig.kucoinAddr : '  KuCoin: N/A'}`);
      console.log(`  Buy on:  ${opp.buyExchange.toUpperCase()} @ $${opp.buyPrice.toFixed(8)}`);
      console.log(`  Sell on: ${opp.sellExchange.toUpperCase()} @ $${opp.sellPrice.toFixed(8)}`);
      console.log(`  Profit:  ${opp.profitPercent.toFixed(2)}%`);
      console.log(`  Spread:  $${(opp.sellPrice - opp.buyPrice).toFixed(8)}`);
    });

    console.log(`\n${'='.repeat(120)}\n`);
  }

  // Main detection loop
  async start() {
    console.log('🤖 CEX Arbitrage Detector Started');
    console.log(`📊 Monitoring pairs:`);
    this.monitoringPairs.forEach(p => {
      console.log(`   ${p.display}`);
      console.log(`     ├─ Binance: ${p.binanceAddr || 'default'}`);
      console.log(`     ├─ MEXC:    ${p.mexcAddr || 'default'}`);
      console.log(`     └─ KuCoin:  ${p.kucoinAddr || 'default'}`);
    });
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
      this.displayPrices(prices);
      const opportunities = this.detectArbitrage(prices);

      if (opportunities.length > 0) {
        this.opportunities = opportunities;
        this.displayOpportunities(opportunities);
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
