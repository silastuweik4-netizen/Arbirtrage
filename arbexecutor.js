require("dotenv").config();
const { ethers } = require("ethers");

// Validate env vars
const RPC_URL = process.env.RPC_URL || "https://base.llamarpc.com";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ARB_CONTRACT_ADDRESS = "0x68168c8A65DA9Ed1cb2B674E2039C31a40BFC336";

// ABI for ArbExecutor contract
const ABI = [
  "function flashloanAndArb((uint8 dexBuy, uint8 dexSell, address routerBuy, address routerSell, address tokenIn, address tokenMid, address tokenOut, uint256 amountIn, uint256 minBuyOut, uint256 minSellOut, uint24 feeBuy, uint24 feeSell, bool stableBuy, bool stableSell, address factoryBuy, address factorySell, address recipient)) external"
];

// Provider
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

async function executeArb(params) {
  console.log(`[ArbExecutor] Attempting execution with contract: ${ARB_CONTRACT_ADDRESS}`);

  if (!PRIVATE_KEY || PRIVATE_KEY.includes("YOUR_PRIVATE_KEY")) {
    console.log("[ArbExecutor] Skipping execution: No valid PRIVATE_KEY provided (READ-ONLY MODE)");
    return;
  }

  try {
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const contract = new ethers.Contract(ARB_CONTRACT_ADDRESS, ABI, wallet);

    const tx = await contract.flashloanAndArb(params, {
      gasLimit: 1000000
    });
    console.log(`[ArbExecutor] Tx submitted: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`[ArbExecutor] Tx confirmed in block: ${receipt.blockNumber}`);

    return receipt;
  } catch (err) {
    console.error("[ArbExecutor] Arb execution failed:", err.message);
    // Don't throw, just log so the detector can continue scanning
  }
}

module.exports = { executeArb };
