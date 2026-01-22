// pathfinder.js
const { ethers } = require("ethers");
const { discoverAllPools } = require("./pool_discovery");

/**
 * The Pathfinder finds the best route between tokens by checking all discovered pools.
 * It supports Triangular Arbitrage: Token A -> Token B -> Token C -> Token A
 */
class Pathfinder {
    constructor(baseTokens) {
        this.baseTokens = baseTokens; // e.g., [WETH, USDC, cbBTC]
        this.poolCache = {};
    }

    async buildGraph(targetToken) {
        const tokensToScan = [...this.baseTokens, targetToken];
        const graph = {};

        for (let i = 0; i < tokensToScan.length; i++) {
            for (let j = i + 1; j < tokensToScan.length; j++) {
                const t1 = tokensToScan[i];
                const t2 = tokensToScan[j];
                
                const pools = await discoverAllPools(t1, t2);
                if (pools.length > 0) {
                    if (!graph[t1]) graph[t1] = [];
                    if (!graph[t2]) graph[t2] = [];
                    
                    graph[t1].push({ to: t2, pools });
                    graph[t2].push({ to: t1, pools });
                }
            }
        }
        return graph;
    }

    /**
     * Finds all triangular cycles starting and ending at a base token (e.g., WETH)
     * involving the target token (e.g., $VIRTUAL)
     */
    async findTriangularRoutes(startToken, targetToken) {
        const graph = await this.buildGraph(targetToken);
        const routes = [];

        // Route: Start -> Target -> Intermediate -> Start
        if (graph[startToken]) {
            for (const edge1 of graph[startToken]) {
                if (edge1.to === targetToken) {
                    // We found Start -> Target
                    for (const edge2 of graph[targetToken]) {
                        const intermediate = edge2.to;
                        if (intermediate === startToken) continue; // Skip direct back-and-forth

                        // Check if Intermediate -> Start exists
                        const edge3 = graph[intermediate]?.find(e => e.to === startToken);
                        if (edge3) {
                            routes.push({
                                path: [startToken, targetToken, intermediate, startToken],
                                pools: [edge1.pools, edge2.pools, edge3.pools]
                            });
                        }
                    }
                }
            }
        }
        return routes;
    }
}

module.exports = { Pathfinder };
