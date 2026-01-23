// v3_dynamic_bot.js
require("dotenv").config();
const { ethers } = require("ethers");
const { HybridDiscoveryEngine } = require("./hybrid_discovery");
const { Pathfinder } = require("./pathfinder");
const { LiquidityOptimizer } = require("./liquidity_optimizer");
const { executeArb } = require("./arbexecutor");

const BASE_TOKENS = [
    ethers.utils.getAddress("0x4200000000000000000000000000000000000006"), // WETH
    ethers.utils.getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"), // USDC
    ethers.utils.getAddress("0xcbB7C915417833f50075de95246D504f013c144f")  // cbBTC
];

async function main() {
    console.log("🔥 Starting Enhanced Hybrid Arbitrage Bot...");
    
    const discovery = new HybridDiscoveryEngine();
    const pathfinder = new Pathfinder(BASE_TOKENS);
    
    // 1. Initialize Discovery (Crawl + Start Listener)
    const { tokens, pools } = await discovery.initialize(150);
    console.log(`✅ Discovery Engine Ready. Monitoring ${tokens.length} tokens and ${pools.length} pools.`);

    let activeRoutes = [];

    // Function to rebuild routes when new tokens/pools are found
    const rebuildRoutes = async () => {
        console.log("🔄 Rebuilding arbitrage routes...");
        const allTokens = discovery.getTokens();
        const newRoutes = [];
        
        // Find triangular routes for each discovered token against base tokens
        for (const token of allTokens) {
            if (BASE_TOKENS.includes(token)) continue;
            const routes = await pathfinder.findTriangularRoutes(BASE_TOKENS[0], token);
            newRoutes.push(...routes);
        }
        
        activeRoutes = newRoutes;
        console.log(`✅ Active Routes Updated: ${activeRoutes.length} routes found.`);
    };

    // Initial route build
    await rebuildRoutes();

    // Rebuild routes whenever the discovery engine finds something new
    discovery.onUpdate(async (newPool) => {
        console.log(`✨ New pool detected at ${newPool.address}. Updating routes...`);
        await rebuildRoutes();
    });

    // 2. Continuous Monitoring Loop
    console.log("🚀 Entering monitoring loop...");
    setInterval(async () => {
        if (activeRoutes.length === 0) return;
        
        // Pick a random route to check each interval to avoid RPC rate limits
        const route = activeRoutes[Math.floor(Math.random() * activeRoutes.length)];
        console.log(`\n📊 Checking Route: ${route.path.join(" -> ")}`);
        
        // Execution logic would go here...
        // 1. Get quotes for the route
        // 2. Check profitability
        // 3. Optimize size
        // 4. Execute
    }, 5000);
}

main().catch(console.error);
