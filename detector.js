require("dotenv").config();
const { ethers } = require("ethers");
const { executeArb } = require("./executor");

const RPC_URL = process.env.RPC_URL || "https://base.llamarpc.com";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

// --- FACTORY ADDRESSES ---
const UNI_FACTORY = ethers.utils.getAddress("0x1F98431c8aD98523631AE4a59f267346ea31F984");       // Uniswap V3 Factory
const PANCAKE_FACTORY = ethers.utils.getAddress("0x1097053Fd2ea711dad45caCcc45EfF7548fCB362");   // PancakeSwap V3 Factory
const AERO_FACTORY = ethers.utils.getAddress("0x420dd381b31aefb7ce6b0e08d83c6f7e3f3eabce");      // Aerodrome Factory

// --- ABIs ---
const UNI_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"
];
const PANCAKE_FACTORY_ABI = UNI_FACTORY_ABI;
const AERO_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, bool stable) view returns (address)"
];

const V3_POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

// --- TOKENS TO SCAN ---
// Normalize all addresses to correct checksum
const TOKENS = {
  WETH: ethers.utils.getAddress("0x4200000000000000000000000000000000000006"),
  USDC: ethers.utils.getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54b1a51ce3"),
  DAI:  ethers.utils.getAddress("0x50c5725949a6f0c72e6c4a641f24049a917db0cb")
};

// --- Helpers to get pools ---
async function getUniswapPool(tokenA, tokenB, fee) {
  const factory = new ethers.Contract(UNI_FACTORY, UNI_FACTORY_ABI, provider);
  return await factory.getPool(tokenA, tokenB, fee);
}

async function getPancakePool(tokenA, tokenB, fee) {
  const factory = new ethers.Contract(PANCAKE_FACTORY, PANCAKE_FACTORY_ABI, provider);
  return await factory.getPool(tokenA, tokenB, fee);
}

async function getAerodromePool(tokenA, tokenB, stable) {
  const factory = new ethers.Contract(AERO_FACTORY, AERO_FACTORY_ABI, provider);
  return await factory.getPool(tokenA, tokenB, stable);
}

// --- Fetch Pool State ---
async function getPoolState(address, dex) {
  try {
    const pool = new ethers.Contract(address, V3_POOL_ABI, provider);
    const [slot0, liquidity, token0, token1] = await Promise.all([
      pool.slot0(),
      pool.liquidity(),
      pool.token0(),
      pool.token1()
    ]);
    return {
      dex,
      address,
      token0,
      token1,
      sqrtPriceX96: slot0[0].toString(),
      liquidity: liquidity.toString()
    };
  } catch (err) {
    console.error(`[Detector] Failed to fetch ${dex} pool ${address}:`, err.message);
    return null;
  }
}

// --- Price Normalization ---
function getPrice(pool) {
  if (!pool?.sqrtPriceX96) return null;
  const sqrtPrice = ethers.BigNumber.from(pool.sqrtPriceX96);
  const price = sqrtPrice.mul(sqrtPrice).div(ethers.BigNumber.from(2).pow(192));
  return parseFloat(price.toString());
}

// --- Detector ---
async function detectArb() {
  console.log("\n[Detector] Generating pools via factories...");

  const pools = [];

  // Loop through token combinations
  const tokenKeys = Object.keys(TOKENS);
  for (let i = 0; i < tokenKeys.length; i++) {
    for (let j = i + 1; j < tokenKeys.length; j++) {
      const tokenA = TOKENS[tokenKeys[i]];
      const tokenB = TOKENS[tokenKeys[j]];

      // Uniswap V3 (fee tiers: 500, 3000, 10000)
      for (const fee of [500, 3000, 10000]) {
        const uniPool = await getUniswapPool(tokenA, tokenB, fee);
        if (uniPool !== ethers.constants.AddressZero) {
          pools.push(await getPoolState(uniPool, "UniswapV3"));
        }
      }

      // Pancake V3 (fee tiers: 2500, 500, 10000)
      for (const fee of [2500, 500, 10000]) {
        const pancakePool = await getPancakePool(tokenA, tokenB, fee);
        if (pancakePool !== ethers.constants.AddressZero) {
          pools.push(await getPoolState(pancakePool, "PancakeV3"));
        }
      }

      // Aerodrome (stable + volatile)
      for (const stable of [true, false]) {
        const aeroPool = await getAerodromePool(tokenA, tokenB, stable);
        if (aeroPool !== ethers.constants.AddressZero) {
          pools.push(await getPoolState(aeroPool, "Aerodrome"));
        }
      }
    }
  }

  const poolStates = pools.filter(Boolean);

  if (poolStates.length === 0) {
    console.log("[Detector] No pools fetched, skipping detection.");
    return;
  }

  // Build token registry
  const tokens = new Set();
  poolStates.forEach(p => {
    tokens.add(p.token0);
    tokens.add(p.token1);
  });
  console.log(`[Detector] Discovered tokens: ${Array.from(tokens).join(", ")}`);

  // --- Direct Arbitrage ---
  for (let i = 0; i < poolStates.length; i++) {
    for (let j = i + 1; j < poolStates.length; j++) {
      const priceA = getPrice(poolStates[i]);
      const priceB = getPrice(poolStates[j]);
      if (!priceA || !priceB) continue;

      const spread = ((priceA - priceB) / priceB) * 100;
      if (Math.abs(spread) > 2) {
        console.log(
          `[Detector] Direct Arb: ${spread.toFixed(2)}% between ${poolStates[i].dex} and ${poolStates[j].dex}`
        );

        const params = {
          tokenBorrow: poolStates[i].token0,
          amountBorrow: ethers.utils.parseUnits("100", 18),
          tokenIn: poolStates[i].token0,
          tokenOut: poolStates[i].token1,
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
            const pool = poolStates.find(
              p =>
                (p.token0 === tokenA && p.token1 === tokenB) ||
                (p.token0 === tokenB && p.token1 === tokenA)
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
