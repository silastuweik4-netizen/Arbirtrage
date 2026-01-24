require("dotenv").config();
const { ethers } = require("ethers");

// Validate env vars
const RPC_URL = process.env.RPC_URL || "https://base.llamarpc.com";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ARB_CONTRACT_ADDRESS = process.env.ARB_CONTRACT_ADDRESS || "0x68168c8A65DA9Ed1cb2B674E2039C31a40BFC336";

// ABI for ArbitrageFlashloan contract
const ABI = [
  "function initiateFlashloan((address tokenBorrow, uint256 amountBorrow, address tokenIn, address tokenOut, uint256 minAmountOut, bytes swapDataA_Uni, bytes swapDataA_Aero, bytes swapDataB_Uni, bytes swapDataB_Aero)) external",
  "event ArbitrageExecuted(address indexed token, uint256 profit)",
  "event FlashloanInitiated(address indexed token, uint256 amount)"
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

    // Note: The params object passed from detector.js must match the TradeParams struct:
    // {
    //   tokenBorrow: string,
    //   amountBorrow: BigNumber,
    //   tokenIn: string,
    //   tokenOut: string,
    //   minAmountOut: BigNumber,
    //   swapDataA_Uni: string (hex),
    //   swapDataA_Aero: string (hex),
    //   swapDataB_Uni: string (hex),
    //   swapDataB_Aero: string (hex)
    // }

    console.log(`[ArbExecutor] Initiating flashloan for ${ethers.utils.formatUnits(params.amountBorrow, 18)} tokens...`);

    // Dynamic Gas Estimation
    const feeData = await provider.getFeeData();
    const priorityFee = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits("2", "gwei");
    
    console.log(`[ArbExecutor] Using Priority Fee: ${ethers.utils.formatUnits(priorityFee, "gwei")} gwei`);

    const tx = await contract.initiateFlashloan(params, {
      gasLimit: 1500000,
      maxPriorityFeePerGas: priorityFee,
      maxFeePerGas: feeData.maxFeePerGas || priorityFee.mul(2)
    });
    
    console.log(`[ArbExecutor] Tx submitted: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`[ArbExecutor] Tx confirmed in block: ${receipt.blockNumber}`);

    // Check for ArbitrageExecuted event
    const event = receipt.events?.find(e => e.event === 'ArbitrageExecuted');
    if (event) {
      const profit = event.args.profit;
      console.log(`[ArbExecutor] ✅ SUCCESS! Profit: ${ethers.utils.formatUnits(profit, 18)}`);
    }

    return receipt;
  } catch (err) {
    console.error("[ArbExecutor] ❌ Arb execution failed:", err.message);
    if (err.data) {
      console.error("[ArbExecutor] Revert reason:", err.data);
    }
  }
}

module.exports = { executeArb };
