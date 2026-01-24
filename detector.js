require("dotenv").config();
const axios = require("axios");
const { ethers } = require("ethers");
const { executeArb } = require("./executor");

// --- CONFIG ---
const RPC_URL = process.env.RPC_URL || "https://base.llamarpc.com";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

// --- FETCH POOLS ---
// Uniswap V3 on Base (public subgraph endpoint)
async function fetchUniswapPools() {
  const query = `
    {
      pools(first: 50) {
        id
        token0 { id symbol }
        token1 { id symbol }
        feeTier
        sqrtPriceX96
        liquidity
      }
    }
  `;
  try {
    const res = await axios.post(
      "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-base",
      { query }
    );
    if (!res.data || !res.data.data || !res.data.data.pools) {
      console.error("[Detector] Uniswap Base subgraph returned no pools");
      return [];
    }
    return res.data.data.pools.map(p => ({ dex: "Uniswap", ...p }));
  } catch (err) {
    console.error("[Detector] Uniswap fetch failed:", err.message);
    return [];
  }
}

// Aerodrome API (correct domain)
async function fetchAerodromePools() {
  try {
    const res = await axios.get("https://api.aerodrome.xyz/pools");
    if (!res.data || !res.data.pools) {
      console.error("[Detector] Aerodrome API returned no pools");
      return [];
    }
    return res.data.pools.map(p => ({ dex: "Aerodrome", ...p }));
  } catch (err) {
    console.error("[Detector] Aerodrome fetch failed:", err.message);
    return [];
  }
}

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

  if (allPools.length === 0) {
    console.log("[Detector] No pools fetched, skipping detection.");
    return;
  }

  // Build dynamic token registry
  const tokens = new Set();
  allPools.forEach(p => {
    if (p.token0?.symbol) tokens.add(p.token0.symbol);
    if (p.token1?.symbol) tokens.add(p.token1.symbol);
  });
  console.log(`[Detector] Discovered tokens: ${Array.from(tokens).join(", ")}`);

  // --- Direct Arbitrage ---
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

        const params = {
          tokenBorrow: allPools[i].token0?.id || ethers.constants.AddressZero,
          amountBorrow: ethers.utils.parseUnits("100", 18),
          tokenIn: allPools[i].token0?.id || ethers.constants.AddressZero,
          tokenOut: allPools[i].token1?.id || ethers.constants.AddressZero,
          minAmountOut: ethers.utils.parseUnits("95", 18),
          swapDataA_Uni: "0x",
          swapDataA_Aero: "0x",
          swapDataB_Uni: "0x",
          swapDataB_Aero: "0x"
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
                (p.token0?.symbol === tokenA && p.token1?.symbol === tokenB) ||
                (p.token0?.symbol === tokenB && p.token1?.symbol === tokenA)
            );
            if (!pool) {
              rate = null;
              break;
            }
            rate *= getPrice(pool) || 1;
          }

          if (rate && rate > 1.02) {
            console.log(
              `[Detector] Triangular Arb: ${((rate - 1) * 100).toFixed(2)}% via path ${path.join(" -> ")}`
            );
            // Build params for executor here if desired
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
