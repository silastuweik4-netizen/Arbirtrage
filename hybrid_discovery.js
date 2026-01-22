// hybrid_discovery.js
const { crawlFactories } = require("./factory_crawler");
const { startEventListener } = require("./event_listener");

class HybridDiscoveryEngine {
    constructor() {
        this.tokens = new Set();
        this.pools = [];
        this.onUpdateCallback = null;
    }

    async initialize(limit = 200) {
        console.log("🚀 Initializing Hybrid Discovery Engine...");
        
        // 1. Initial Crawl
        const { tokens, pools } = await crawlFactories(limit);
        tokens.forEach(t => this.tokens.add(t));
        this.pools = pools;

        // 2. Start Real-Time Listener
        startEventListener((newPool) => {
            this.tokens.add(newPool.token0);
            this.tokens.add(newPool.token1);
            this.pools.push(newPool);
            
            if (this.onUpdateCallback) {
                this.onUpdateCallback(newPool, Array.from(this.tokens));
            }
        });

        return { tokens: Array.from(this.tokens), pools: this.pools };
    }

    onUpdate(callback) {
        this.onUpdateCallback = callback;
    }

    getTokens() {
        return Array.from(this.tokens);
    }

    getPools() {
        return this.pools;
    }
}

module.exports = { HybridDiscoveryEngine };
