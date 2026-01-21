const { ethers } = require("ethers");
require("dotenv").config();

// Base Mainnet RPC
const RPC_URL = process.env.RPC_URL;
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

// Hard-coded addresses
const UNIV3_QUOTER = "0x0CdeE061c75D43c82520eD998C23ac2991c9ac6d";
const AERODROME_ROUTER = "0x6bded42c6da8fbf0d2ba55b2fa120c5e0c8d7891";

// ABIs
const IQuoterABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];
const IRouterV2ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)"
];

// Tokens
const TOKENS = {
  WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  USDC: { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
  AERO: { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 }
};

async function testUniswapV3() {
  const quoter = new ethers.Contract(UNIV3_QUOTER, IQuoterABI, provider);
  const amountIn = ethers.utils.parseUnits("1", TOKENS.WETH.decimals);
  const out = await quoter.callStatic.quoteExactInputSingle(
    TOKENS.WETH.address,
    TOKENS.USDC.address,
    3000, // fee tier
    amountIn,
    0
  );
  console.log("Uniswap v3 WETH→USDC (1 WETH):", ethers.utils.formatUnits(out, TOKENS.USDC.decimals));
}

async function testAerodrome() {
  const router = new ethers.Contract(AERODROME_ROUTER, IRouterV2ABI, provider);
  const amountIn = ethers.utils.parseUnits("100", TOKENS.AERO.decimals);
  const path = [TOKENS.AERO.address, TOKENS.USDC.address];
  const amounts = await router.getAmountsOut(amountIn, path);
  console.log("Aerodrome AERO→USDC (100 AERO):", ethers.utils.formatUnits(amounts[1], TOKENS.USDC.decimals));
}

async function main() {
  await testUniswapV3();
  await testAerodrome();
}

main().catch(err => {
  console.error("Error:", err);
});
