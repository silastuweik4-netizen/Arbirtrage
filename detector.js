require("dotenv").config();
const axios = require("axios");
const { ethers } = require("ethers");
const { executeArb } = require("./executor");

// --- CONFIG ---
const RPC_URL = process.env.RPC_URL;
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

// --- FETCH POOLS ---
// Uniswap V3 via The Graph
async function fetchUniswapPools() {
  const query = `
    {
      pools(first: 500) {
        id
        token0 { id symbol }
        token1 { id symbol }
        feeTier
        sqrtPriceX96
        liquidity
      }
    }
  `;
  const res = await axios.post(
    "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3",
    { query }
  );
  return res.data.data.pools.map(p => ({ dex: "Uniswap", ...p }));
}

// Aerodrome API
async function fetchAerodromePools() {
  const res = await axios.get("https://api.aerodrome.finance/pools");
  return res.data.pools.map(p => ({ dex: "Aerodrome", ...p }));
}

// Add other DEX fetchers here (Sushi, etc.)

// --- PRICE NORMALIZATION ---
function getPrice(pool) {
  if (pool.sqrtPriceX96) {
    return parseFloat(pool.sqrtPriceX96) / 1e18;
  }
  if (pool.price) {
    return parseFloat(pool.price);
  }
  return null;
}

// --- DETECTOR ---
async function detectArb() {
  console.log("\n[Detector] Fetching pools across all DEXs...");

  const uniPools = await fetchUniswapPools();
  const aeroPools = await fetchAerodromePools();
  const allPools = [...uniPools, ...aeroPools];

  // Build dynamic token registry
  const tokens = new Set();
  allPools.forEach(p => {
    tokens.add(p.token0.symbol);
    tokens.add(p.token1.symbol);
  });
  console.log(`[Detector] Discovered tokens: ${Array.from(tokens).join(", ")}`);

  // --- Direct Arbitrage (intra + cross DEX) ---
  for (let i = 0; i < allPools.length; i++) {
    for (let j = i + 1; j < allPools.length; j++) {
      const priceA = getPrice(allPools[i]);
      const priceB = getPrice(allPools[j]);
      if (!priceA || !priceB) continue;

      const spread = ((priceA - priceB) / priceB) * 100;
      if (Math.abs(spread) > 2) {
        console.log(
          `[Detector] Direct Arb: ${spread.toFixed(2)}% between ${allPools[i].dex} pool ${allPools[i].id} and ${allPools[j].dex} pool ${allPools[j].id}`
        );

        // Example params for executor
        const params = {
          tokenBorrow: allPools[i].token0.id,
          amountBorrow: ethers.utils.parseUnits("100", 18),
          tokenIn: allPools[i].token0.id,
          tokenOut: allPools[i].token1.id,
          minAmountOut: ethers.utils.parseUnits("95", 18),
          swapDataA_Uni: "0x...", // fill with actual calldata
          swapDataA_Aero: "0x...",
          swapDataB_Uni: "0x...",
          swapDataB_Aero: "0x..."
        };

        await executeArb(params);
      }
    }
  }

  // --- Triangular Arbitrage ---
  const tokenList = Array.from(tokens);
  for (let a = 0; a < tokenList.length; a++) {
    for (let b = 0; b < tokenList.length; b++) {
      for (let c = 0; c < tokenList.length; c++) {
        if (a !== b && b !== c && c !== a) {
          const path = [tokenList[a], tokenList[b], tokenList[c], tokenList[a]];

          let rate = 1;
          for (let i = 0; i < path.length - 1; i++) {
            const tokenA = path[i];
            const tokenB = path[i + 1];
            const pool = allPools.find(
              p =>
                (p.token0.symbol === tokenA && p.token1.symbol === tokenB) ||
                (p.token0.symbol === tokenB && p.token1.symbol === tokenA)
            );
            if (!pool) {
              rate = null;
              break;
            }
            rate *= getPrice(pool);
          }

          if (rate && rate > 1.02) {
            console.log(
              `[Detector] Triangular Arb: ${((rate - 1) * 100).toFixed(2)}% via path ${path.join(" -> ")}`
            );
            // Build params for executor here
          }
        }
      }
    }
  }
}

// --- RUN ---
(async () => {
  await detectArb();
})();
