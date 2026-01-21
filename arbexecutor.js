require("dotenv").config();
const { ethers } = require("ethers");

// Validate env vars
const { RPC_URL, PRIVATE_KEY, ARB_CONTRACT_ADDRESS } = process.env;
if (!RPC_URL || !PRIVATE_KEY || !ARB_CONTRACT_ADDRESS) {
  throw new Error("Missing required environment variables: RPC_URL, PRIVATE_KEY, ARB_CONTRACT_ADDRESS");
}

// ABI for ArbExecutor contract
const ABI = [
  "function flashloanAndArb((uint8,uint8,address,address,address,address,address,uint256,uint256,uint256,uint24,uint24,bool,bool,address,address,address)) external"
];

// Provider + wallet
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Contract instance
const contract = new ethers.Contract(ARB_CONTRACT_ADDRESS, ABI, wallet);

async function executeArb(params) {
  console.log(`[ArbExecutor] Executing arb with contract: ${ARB_CONTRACT_ADDRESS}`);

  try {
    const tx = await contract.flashloanAndArb(params, {
      // optional: tune gas settings
      // gasLimit: 1_000_000,
      // maxFeePerGas: ethers.utils.parseUnits("50", "gwei"),
    });
    console.log(`[ArbExecutor] Tx submitted: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`[ArbExecutor] Tx confirmed in block: ${receipt.blockNumber}`);

    return receipt;
  } catch (err) {
    console.error("[ArbExecutor] Arb execution failed:", err);
    throw err;
  }
}

module.exports = { executeArb };
