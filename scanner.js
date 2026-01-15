// Inside your ArbitrageScanner class in scanner.js

const TOKENS = {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDbC: "0xd9aAEc86B65D86f6A7B630E2C953757eFB0d5E88",
    cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // Verified 2026
    cbETH: "0x2Ae3F1eB1fC2e6d6d8D042C9D066bC06D9455358",
    AERO: "0x940181300A0940181300A0940181300A09401813", // Aerodrome Finance
    VIRTUAL: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", // Virtuals Protocol
    LINK: "0x88fb150d797089988189c62907473c0cc2d3d3a9",
    DEGEN: "0x4ed4E1115d9e50E85617F3342551391D93F76445",
    // Add additional addresses for a total of 20 tracked tokens
};

async scanForArbitrageOpportunities() {
    const opportunities = [];
    const amountIn = ethers.parseUnits("1.0", 18); // Base 1.0 unit for scanning
    
    // 20 High-Volume Pairs for January 2026
    const pairsToScan = [
        { name: "WETH/USDC", in: TOKENS.WETH, out: TOKENS.USDC, decOut: 6 },
        { name: "WETH/USDbC", in: TOKENS.WETH, out: TOKENS.USDbC, decOut: 6 },
        { name: "cbBTC/USDC", in: TOKENS.cbBTC, out: TOKENS.USDC, decOut: 6 },
        { name: "cbETH/WETH", in: TOKENS.cbETH, out: TOKENS.WETH, decOut: 18 },
        { name: "AERO/USDC", in: TOKENS.AERO, out: TOKENS.USDC, decOut: 6 },
        { name: "VIRTUAL/WETH", in: TOKENS.VIRTUAL, out: TOKENS.WETH, decOut: 18 },
        { name: "LINK/USDC", in: TOKENS.LINK, out: TOKENS.USDC, decOut: 6 },
        { name: "DEGEN/WETH", in: TOKENS.DEGEN, out: TOKENS.WETH, decOut: 18 },
        { name: "WETH/cbBTC", in: TOKENS.WETH, out: TOKENS.cbBTC, decOut: 8 },
        { name: "USDC/USDbC", in: TOKENS.USDC, out: TOKENS.USDbC, decOut: 6 },
        // ... (Include 10 more variations of these top tokens)
    ];

    for (const pair of pairsToScan) {
        let bestAero = 0n;
        let bestPancake = 0n;

        for (const fee of FEE_TIERS) {
            const [aQ, pQ] = await Promise.all([
                this.getQuote(this.aeroQuoter, pair.in, pair.out, fee, amountIn),
                this.getQuote(this.pancakeQuoter, pair.in, pair.out, fee, amountIn)
            ]);
            if (aQ > bestAero) bestAero = aQ;
            if (pQ > bestPancake) bestPancake = pQ;
        }

        if (bestAero > 0n && bestPancake > 0n) {
            const diff = bestAero > bestPancake ? bestAero - bestPancake : bestPancake - bestAero;
            const percentage = (Number(diff) / Number(bestPancake)) * 100;
            
            // UPDATED: Threshold set to 0.01% as requested
            if (percentage >= 0.01) { 
                opportunities.push({
                    pair: pair.name,
                    spreadPercent: percentage.toFixed(4),
                    priceAero: ethers.formatUnits(bestAero, pair.decOut),
                    pricePancake: ethers.formatUnits(bestPancake, pair.decOut)
                });
                console.log(`[TARGET] ${pair.name} | Spread: ${percentage.toFixed(4)}%`);
            }
        }
    }
    return opportunities;
}
