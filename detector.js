// arbitrageDetector.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const exchanges = {
  binance: {
    name: 'Binance',
    tickerUrl: 'https://api.binance.com/api/v3/ticker/price',
    orderBookUrl: 'https://api.binance.com/api/v3/depth',
    takerFeePct: parseFloat(process.env.BINANCE_TAKER_FEE_PCT) || 0.10,
    minNotional: 10,
  },
  mexc: {
    name: 'MEXC',
    tickerUrl: 'https://api.mexc.com/api/v3/ticker/price',
    orderBookUrl: 'https://api.mexc.com/api/v3/depth',
    takerFeePct: parseFloat(process.env.MEXC_TAKER_FEE_PCT) || 0.20,
    minNotional: 10,
  },
  deepcoin: {
    name: 'Deepcoin',
    tickerUrl: 'https://api.deepcoin.com/v1/market/tickers',
    orderBookUrl: 'https://api.deepcoin.com/v1/market/depth',
    takerFeePct: parseFloat(process.env.DEEPCOIN_TAKER_FEE_PCT) || 0.20,
    minNotional: 10,
  },
};

// Utilities
const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeSymbol(s) {
  if (!s) return null;
  return s.toString().replace(/[\s\/\-]/g, '').toUpperCase();
}

async function safeGet(url, opts = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await axios.get(url, opts);
      return res;
    } catch (err) {
      if (i === retries) throw err;
      await sleep(300 * (i + 1));
    }
  }
}

// VWAP simulation for selling base amount against bids
function simulateSell(amountBase, orderBook) {
  // orderBook.bids expected as [[price, qty], ...] sorted desc
  let remaining = amountBase;
  let proceeds = 0;
  for (const [priceStr, qtyStr] of orderBook.bids) {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    if (!price || !qty) continue;
    const take = Math.min(remaining, qty);
    proceeds += take * price;
    remaining -= take;
    if (remaining <= 0) break;
  }
  const filled = remaining <= 0;
  const vwap = filled ? proceeds / amountBase : proceeds / (amountBase - remaining || 1);
  return { filled, vwap, proceeds, remaining };
}

// VWAP simulation for buying base amount against asks
function simulateBuy(amountBase, orderBook) {
  let remaining = amountBase;
  let cost = 0;
  for (const [priceStr, qtyStr] of orderBook.asks) {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    if (!price || !qty) continue;
    const take = Math.min(remaining, qty);
    cost += take * price;
    remaining -= take;
    if (remaining <= 0) break;
  }
  const filled = remaining <= 0;
  const vwap = filled ? cost / amountBase : cost / (amountBase - remaining || 1);
  return { filled, vwap, cost, remaining };
}

function netProfitUsd(buyCostUsd, sellProceedsUsd, buyFeePct, sellFeePct, transferCostUsd = 0) {
  const costWithFee = buyCostUsd * (1 + buyFeePct / 100);
  const revenueAfterFee = sellProceedsUsd * (1 - sellFeePct / 100);
  return revenueAfterFee - costWithFee - transferCostUsd;
}

class ArbitrageDetector {
  constructor() {
    this.prices = {};
    this.opportunities = [];
    this.minProfitPercent = parseFloat(process.env.MIN_PROFIT_PERCENT) || 1.5;
    this.fetchInterval = parseInt(process.env.FETCH_INTERVAL_MS) || 10000;
    this.tradeSizeBase = parseFloat(process.env.TRADE_SIZE_BASE) || 1000; // base token amount to simulate
    this.monitoringPairs = this.parseMonitoringPairs();
  }

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

  // Fetch tickers with defensive parsing
  async fetchBinance() {
    try {
      const res = await safeGet(exchanges.binance.tickerUrl, { timeout: 5000 });
      const data = res.data || [];
      const prices = {};
      (Array.isArray(data) ? data : []).forEach(t => {
        const sym = normalizeSymbol(t.symbol || t.symbolName || t.pair);
        const price = parseFloat(t.price ?? t.last ?? t.close);
        if (sym && !Number.isNaN(price)) prices[sym] = price;
      });
      return prices;
    } catch (err) {
      console.error('Binance fetch error:', err.message);
      return {};
    }
  }

  async fetchMexc() {
    try {
      const res = await safeGet(exchanges.mexc.tickerUrl, { timeout: 5000 });
      const data = res.data || [];
      const prices = {};
      if (Array.isArray(data)) {
        data.forEach(t => {
          const sym = normalizeSymbol(t.symbol || t.pair || t.market);
          const price = parseFloat(t.price ?? t.last ?? t.close);
          if (sym && !Number.isNaN(price)) prices[sym] = price;
        });
      } else if (data.data && Array.isArray(data.data)) {
        data.data.forEach(t => {
          const sym = normalizeSymbol(t.symbol || t.pair);
          const price = parseFloat(t.price ?? t.last);
          if (sym && !Number.isNaN(price)) prices[sym] = price;
        });
      } else if (typeof data === 'object') {
        Object.entries(data).forEach(([k, v]) => {
          const sym = normalizeSymbol(k);
          const price = parseFloat(v.price ?? v.last ?? v.close);
          if (sym && !Number.isNaN(price)) prices[sym] = price;
        });
      }
      return prices;
    } catch (err) {
      console.error('MEXC fetch error:', err.message);
      return {};
    }
  }

  async fetchDeepcoin() {
    try {
      const res = await safeGet(exchanges.deepcoin.tickerUrl, { timeout: 5000 });
      const raw = res.data;
      let tickers = [];

      if (Array.isArray(raw)) tickers = raw;
      else if (raw && Array.isArray(raw.data)) tickers = raw.data;
      else if (raw && Array.isArray(raw.tickers)) tickers = raw.tickers;
      else if (raw && typeof raw === 'object') {
        // keyed object
        tickers = Object.entries(raw).map(([symbol, obj]) => {
          return { symbol, last: obj.last ?? obj.price ?? obj.close };
        });
      } else {
        throw new Error('Unexpected Deepcoin response shape');
      }

      const prices = {};
      tickers.forEach(t => {
        const sym = normalizeSymbol(t.symbol || t.pair || t.market);
        const price = parseFloat(t.last ?? t.price ?? t.close ?? t.lastPrice);
        if (sym && !Number.isNaN(price)) prices[sym] = price;
      });
      return prices;
    } catch (err) {
      console.error('Deepcoin fetch error:', err.message);
      return {};
    }
  }

  async fetchOrderBook(exchangeKey, symbol, limit = 100) {
    try {
      const ex = exchanges[exchangeKey];
      if (!ex || !ex.orderBookUrl) return null;

      // Normalize symbol to exchange format if needed
      const params = { symbol: symbol, limit };
      // Some exchanges expect symbol without slash, some with. Try both.
      let res;
      try {
        res = await safeGet(ex.orderBookUrl, { params, timeout: 5000 });
      } catch (e) {
        // try alternate symbol format
        const alt = symbol.replace('/', '');
        res = await safeGet(ex.orderBookUrl, { params: { symbol: alt, limit }, timeout: 5000 });
      }

      const data = res.data || res.data?.data || {};
      // Normalize to { bids: [[price, qty], ...], asks: [[price, qty], ...]] }
      if (Array.isArray(data.bids) && Array.isArray(data.asks)) {
        return { bids: data.bids, asks: data.asks };
      } else if (Array.isArray(data)) {
        // Some endpoints return [ { bids:..., asks:... } ]
        const first = data[0] || {};
        if (Array.isArray(first.bids) && Array.isArray(first.asks)) return { bids: first.bids, asks: first.asks };
      } else if (data && data.ticker) {
        // fallback shape
        return { bids: data.ticker.bids || [], asks: data.ticker.asks || [] };
      }
      // If unknown shape, attempt to parse common keys
      const bids = data.bids || data.buy || [];
      const asks = data.asks || data.sell || [];
      return { bids, asks };
    } catch (err) {
      console.error(`Order book fetch error for ${exchangeKey} ${symbol}:`, err.message);
      return null;
    }
  }

  async fetchAllPrices() {
    const [binance, mexc, deepcoin] = await Promise.all([
      this.fetchBinance(),
      this.fetchMexc(),
      this.fetchDeepcoin(),
    ]);
    return { binance, mexc, deepcoin };
  }

  // Detect arbitrage using VWAP simulation for a configured trade size
  async detectArbitrage(prices) {
    const opportunities = [];
    for (const pair of this.monitoringPairs) {
      const symbol = normalizeSymbol(pair.base + pair.quote); // e.g., BTCUSDT
      const exPrices = {};
      if (prices.binance && prices.binance[symbol]) exPrices.binance = prices.binance[symbol];
      if (prices.mexc && prices.mexc[symbol]) exPrices.mexc = prices.mexc[symbol];
      if (prices.deepcoin && prices.deepcoin[symbol]) exPrices.deepcoin = prices.deepcoin[symbol];

      const exList = Object.keys(exPrices);
      if (exList.length < 2) continue;

      // For each pair of exchanges, simulate buy on cheaper and sell on pricier using order books
      for (let i = 0; i < exList.length; i++) {
        for (let j = i + 1; j < exList.length; j++) {
          const exBuy = exList[i];
          const exSell = exList[j];
          const buyPriceTicker = exPrices[exBuy];
          const sellPriceTicker = exPrices[exSell];

          // Quick filter by ticker spread
          const rawProfitPct = ((sellPriceTicker - buyPriceTicker) / buyPriceTicker) * 100;
          if (Math.abs(rawProfitPct) < this.minProfitPercent) continue;

          // Fetch order books and simulate fills for tradeSizeBase
          const tradeSize = this.tradeSizeBase;
          const [buyOb, sellOb] = await Promise.all([
            this.fetchOrderBook(exBuy, pair.base + pair.quote),
            this.fetchOrderBook(exSell, pair.base + pair.quote),
          ]);

          if (!buyOb || !sellOb) continue;

          // Simulate buy then sell
          const buySim = simulateBuy(tradeSize, buyOb); // cost in quote currency
          const sellSim = simulateSell(tradeSize, sellOb); // proceeds in quote currency

          if (!buySim.filled || !sellSim.filled) continue; // cannot fully fill

          // Convert to USD like metric if quote is USDT or USD stable, otherwise treat as quote currency
          const buyCost = buySim.cost;
          const sellProceeds = sellSim.proceeds;

          // Fees and transfer cost assumptions
          const buyFeePct = exchanges[exBuy].takerFeePct;
          const sellFeePct = exchanges[exSell].takerFeePct;
          const transferCostUsd = parseFloat(process.env.TRANSFER_COST_USD) || 0; // e.g., withdrawal + deposit costs

          const profitUsd = netProfitUsd(buyCost, sellProceeds, buyFeePct, sellFeePct, transferCostUsd);
          const profitPct = (profitUsd / buyCost) * 100;

          if (profitPct > this.minProfitPercent) {
            opportunities.push({
              pair: pair.display,
              pairConfig: pair,
              buyExchange: exBuy,
              sellExchange: exSell,
              buyVwap: buySim.vwap,
              sellVwap: sellSim.vwap,
              buyCost,
              sellProceeds,
              profitUsd,
              profitPct,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }
    return opportunities;
  }

  displayPrices(prices) {
    console.log('\n[' + new Date().toISOString() + '] Current Prices:');
    console.log('-'.repeat(100));
    this.monitoringPairs.forEach((pair) => {
      const symbol = normalizeSymbol(pair.base + pair.quote);
      const b = prices.binance[symbol] ? '$' + prices.binance[symbol].toFixed(8) : 'N/A';
      const m = prices.mexc[symbol] ? '$' + prices.mexc[symbol].toFixed(8) : 'N/A';
      const d = prices.deepcoin[symbol] ? '$' + prices.deepcoin[symbol].toFixed(8) : 'N/A';
      console.log(`${pair.display}  B=${b}  M=${m}  D=${d}`);
    });
  }

  displayOpportunities(opps) {
    if (!opps || opps.length === 0) return;
    console.log('\n' + '='.repeat(80));
    console.log('FOUND ' + opps.length + ' ARBITRAGE OPPORTUNITY(IES) at ' + new Date().toISOString());
    console.log('='.repeat(80));
    opps.forEach((opp, idx) => {
      console.log(`\n[${idx + 1}] ${opp.pair}`);
      console.log(`  Buy on:  ${opp.buyExchange.toUpperCase()} @ VWAP ${opp.buyVwap.toFixed(8)}`);
      console.log(`  Sell on: ${opp.sellExchange.toUpperCase()} @ VWAP ${opp.sellVwap.toFixed(8)}`);
      console.log(`  Buy cost: ${opp.buyCost.toFixed(8)}  Sell proceeds: ${opp.sellProceeds.toFixed(8)}`);
      console.log(`  Profit USD: ${opp.profitUsd.toFixed(8)}  Profit pct: ${opp.profitPct.toFixed(4)}%`);
    });
    console.log('\n' + '='.repeat(80) + '\n');
  }

  async start() {
    console.log('CEX Arbitrage Detector Started');
    console.log('Monitoring pairs:');
    this.monitoringPairs.forEach(p => console.log('  ' + p.display));
    console.log('Minimum profit threshold: ' + this.minProfitPercent + '%');
    console.log('Trade simulation size: ' + this.tradeSizeBase);
    await this.updatePrices();
    setInterval(() => this.updatePrices(), this.fetchInterval);
  }

  async updatePrices() {
    try {
      const prices = await this.fetchAllPrices();
      this.displayPrices(prices);
      const opportunities = await this.detectArbitrage(prices);
      if (opportunities.length > 0) {
        this.opportunities = opportunities;
        this.displayOpportunities(opportunities);
      } else {
        this.opportunities = [];
      }
    } catch (err) {
      console.error('Update error:', err.message);
    }
  }

  getOpportunities() {
    return this.opportunities;
  }
}

const detector = new ArbitrageDetector();
export default detector;
