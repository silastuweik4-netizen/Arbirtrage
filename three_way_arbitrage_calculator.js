/**
 * 3-Way Arbitrage Calculator
 * Compares prices across Aerodrome, Uniswap V3, and PancakeSwap
 * Finds optimal profit routes
 */

class ThreeWayArbitrageCalculator {
  constructor() {
    // Cost structure
    this.GAS_COST_BP = 5.0; // Gas for 2 swaps
    this.SLIPPAGE_BP = 1.0; // Conservative slippage estimate
    
    // Fee tiers
    this.FEE_TIERS = {
      '0.01%': { swapFeePerSide: 0.1, name: 'Stablecoin pairs' },
      '0.05%': { swapFeePerSide: 0.5, name: 'Major pairs' },
      '0.30%': { swapFeePerSide: 3.0, name: 'Alt tokens' }
    };

    // DEX names
    this.DEXES = {
      AERO: 'Aerodrome',
      UNI: 'Uniswap V3',
      PANCAKE: 'PancakeSwap'
    };

    // Real data from your spreadsheet
    this.PAIR_DATA = [
      { pair: 'WETH/USDC', fee: '0.05%', uni: 3254.66, pancake: 3254.41, aero: 3254.28, expectedBp: 1.2 },
      { pair: 'WETH/USDbC', fee: '0.05%', uni: 3254.70, pancake: 3254.45, aero: 3254.30, expectedBp: 1.3 },
      { pair: 'cbETH/WETH', fee: '0.05%', uni: 1.00021, pancake: 1.00019, aero: 1.00015, expectedBp: 6.0 },
      { pair: 'wstETH/WETH', fee: '0.05%', uni: 1.2268, pancake: 1.22667, aero: 1.22666, expectedBp: 1.6 },
      { pair: 'WETH/DAI', fee: '0.05%', uni: 3254.60, pancake: 3254.38, aero: 3254.25, expectedBp: 1.1 },
      { pair: 'USDC/USDbC', fee: '0.01%', uni: 0.99905, pancake: 0.99903, aero: 0.99898, expectedBp: 7.0 },
      { pair: 'AERO/WETH', fee: '0.30%', uni: 0.0006154, pancake: 0.0006151, aero: 0.0006148, expectedBp: 10 },
      { pair: 'BRETT/WETH', fee: '0.30%', uni: 0.00000574, pancake: 0.00000573, aero: 0.00000572, expectedBp: 3.5 },
      { pair: 'TOSHI/WETH', fee: '0.30%', uni: 0.00000288, pancake: 0.00000287, aero: 0.00000286, expectedBp: 7.0 },
      { pair: 'DEGEN/WETH', fee: '0.30%', uni: 0.00000122, pancake: 0.00000121, aero: 0.00000120, expectedBp: 17 },
      { pair: 'CAKE/USDC', fee: '0.30%', uni: 1.9105, pancake: 1.9103, aero: 1.9098, expectedBp: 3.7 },
      { pair: 'VIRTUAL/USDC', fee: '0.30%', uni: 1.100, pancake: 1.099, aero: 1.098, expectedBp: 18 },
      { pair: 'AIXBT/USDC', fee: '0.30%', uni: 0.04101, pancake: 0.04098, aero: 0.04092, expectedBp: 22 },
      { pair: 'cbBTC/USDC', fee: '0.05%', uni: 92837, pancake: 92825, aero: 92810, expectedBp: 3.0 },
      { pair: 'CLANKER/WETH', fee: '0.30%', uni: 0.01240, pancake: 0.01238, aero: 0.01236, expectedBp: 3.2 },
      { pair: 'USDe/USDC', fee: '0.01%', uni: 0.9996, pancake: 0.9995, aero: 0.9993, expectedBp: 30 },
      { pair: 'FLOCK/USDC', fee: '0.30%', uni: 0.09497, pancake: 0.09492, aero: 0.09485, expectedBp: 13 },
      { pair: 'MORPHO/WETH', fee: '0.30%', uni: 0.000387, pancake: 0.000386, aero: 0.000385, expectedBp: 5.2 },
      { pair: 'ODOS/WETH', fee: '0.30%', uni: 0.000704, pancake: 0.000703, aero: 0.000702, expectedBp: 2.8 },
      { pair: 'wstETH/USDC', fee: '0.05%', uni: 3992.82, pancake: 3992.55, aero: 3992.10, expectedBp: 1.8 }
    ];
  }

  /**
   * Calculate total costs for a 3-way trade
   */
  calculateTotalCosts(feeType) {
    const feeData = this.FEE_TIERS[feeType];
    if (!feeData) throw new Error(`Unknown fee type: ${feeType}`);
    
    // Two swaps (Aero → Pancake)
    const swapFeeTotal = feeData.swapFeePerSide * 2;
    const totalCosts = swapFeeTotal + this.GAS_COST_BP + this.SLIPPAGE_BP;
    
    return totalCosts;
  }

  /**
   * Calculate spread in basis points
   */
  spreadToBp(lowPrice, highPrice) {
    const spread = (highPrice - lowPrice) / lowPrice;
    return spread * 10000; // Convert to basis points
  }

  /**
   * Find best 3-way route
   * Route: Buy Aero → Sell to highest price DEX
   */
  findBestRoute(pairData) {
    const { pair, fee, uni, pancake, aero } = pairData;
    
    // Aerodrome is cheapest (we buy there)
    // Find which is most expensive (we sell there)
    const prices = [
      { dex: this.DEXES.UNI, price: uni },
      { dex: this.DEXES.PANCAKE, price: pancake },
      { dex: this.DEXES.AERO, price: aero }
    ];
    
    prices.sort((a, b) => b.price - a.price);
    
    const sellDex = prices[0]; // Most expensive
    const grossBp = this.spreadToBp(aero, sellDex.price);
    const costs = this.calculateTotalCosts(fee);
    const netBp = grossBp - costs;
    
    return {
      pair,
      fee,
      buyDex: this.DEXES.AERO,
      buyPrice: aero,
      sellDex: sellDex.dex,
      sellPrice: sellDex.price,
      grossBp: grossBp.toFixed(2),
      costs: costs.toFixed(2),
      netBp: netBp.toFixed(2),
      isProfitable: netBp > 0,
      profitPer100k: (netBp * 10).toFixed(0),
      profitPer1M: (netBp * 100).toFixed(0)
    };
  }

  /**
   * Scan all pairs and rank by profitability
   */
  scanAllPairs() {
    const results = [];
    
    for (const pairData of this.PAIR_DATA) {
      const analysis = this.findBestRoute(pairData);
      results.push(analysis);
    }
    
    // Sort by profitability
    results.sort((a, b) => parseFloat(b.netBp) - parseFloat(a.netBp));
    
    return results;
  }

  /**
   * Get trading recommendation
   */
  getRecommendation(netBp) {
    const bp = parseFloat(netBp);
    
    if (bp >= 20) return '🟢 EXCELLENT: High profit, execute immediately';
    if (bp >= 10) return '🟢 VERY GOOD: Good profit, execute';
    if (bp >= 5) return '🟡 GOOD: Solid profit, consider executing';
    if (bp > 0) return '🟡 MARGINAL: Small profit, needs large capital';
    if (bp >= -2) return '🔴 RISKY: May lose money, skip';
    return '🔴 AVOID: Guaranteed loss';
  }

  /**
   * Format results for display
   */
  formatResults(results, limit = 20) {
    console.log('\n' + '='.repeat(130));
    console.log('3-WAY ARBITRAGE OPPORTUNITIES'.padEnd(130));
    console.log('='.repeat(130));
    console.log(
      'Pair'.padEnd(20) +
      'Fee'.padEnd(8) +
      'Buy (Aero)'.padEnd(15) +
      'Sell (Best)'.padEnd(15) +
      'Gross bp'.padEnd(10) +
      'Costs'.padEnd(8) +
      'Net bp'.padEnd(10) +
      '$/100k'.padEnd(10) +
      '$/1M'.padEnd(12) +
      'Status'.padEnd(20)
    );
    console.log('-'.repeat(130));
    
    results.slice(0, limit).forEach((r, i) => {
      const status = r.isProfitable ? '✅ PROFIT' : '❌ LOSS';
      console.log(
        r.pair.padEnd(20) +
        r.fee.padEnd(8) +
        r.buyPrice.toFixed(6).padEnd(15) +
        r.sellPrice.toFixed(6).padEnd(15) +
        r.grossBp.padEnd(10) +
        r.costs.padEnd(8) +
        r.netBp.padEnd(10) +
        `$${r.profitPer100k}`.padEnd(10) +
        `$${r.profitPer1M}`.padEnd(12) +
        status.padEnd(20)
      );
    });
    
    console.log('='.repeat(130) + '\n');
  }
}

module.exports = ThreeWayArbitrageCalculator;
