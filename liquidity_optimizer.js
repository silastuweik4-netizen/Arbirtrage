// liquidity_optimizer.js
const { ethers } = require("ethers");

/**
 * Optimizes trade size for low-liquidity pools by calculating price impact.
 * It uses a binary search or iterative approach to find the "Sweet Spot"
 * where Net Profit is maximized before slippage eats it all.
 */
class LiquidityOptimizer {
    constructor(quoter) {
        this.quoter = quoter;
    }

    async findOptimalSize(route, minSize, maxSize, steps = 5) {
        let bestSize = minSize;
        let maxNetProfit = ethers.BigNumber.from(0);

        const stepSize = maxSize.sub(minSize).div(steps);

        console.log(`🧪 Optimizing trade size for route...`);

        for (let i = 1; i <= steps; i++) {
            const currentSize = minSize.add(stepSize.mul(i));
            try {
                const amountOut = await this.quoter.getQuoteForRoute(route, currentSize);
                const grossProfit = amountOut.sub(currentSize);
                
                // Estimate gas and flashloan fees (0.05% for Aave)
                const flashloanFee = currentSize.mul(5).div(10000);
                const gasEstimate = ethers.utils.parseEther("0.0005"); // Approx $1.50 on Base
                
                const netProfit = grossProfit.sub(flashloanFee).sub(gasEstimate);

                if (netProfit.gt(maxNetProfit)) {
                    maxNetProfit = netProfit;
                    bestSize = currentSize;
                }
            } catch (e) {
                // If it reverts, we've likely hit liquidity limits
                break;
            }
        }

        return { bestSize, maxNetProfit };
    }
}

module.exports = { LiquidityOptimizer };
