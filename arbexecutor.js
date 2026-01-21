require("dotenv").config();
const { ethers } = require("ethers");

// Load env vars
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.ARB_CONTRACT_ADDRESS;

// ABI for ArbExecutor contract
const ABI = [
  "function flashloanAndArb((uint8,uint8,address,address,address,address,address,uint256,uint256,uint256,uint24,uint24,bool,bool,address,address,address)) external"
];

async function executeArb(params) {
  if (!CONTRACT_ADDRESS) {
    throw new Error("ARB_CONTRACT_ADDRESS not set in environment");
  }

  // Provider + wallet
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  // Contract instance
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  console.log("Executing arb with contract:", CONTRACT_ADDRESS);

  try {
    const tx = await contract.flashloanAndArb(params);
    console.log("Tx submitted:", tx.hash);
    const receipt = await tx.wait();
    console.log("Tx confirmed in block:", receipt.blockNumber);
    return receipt;
  } catch (err) {
    console.error("Arb execution failed:", err);
    throw err;
  }
}

module.exports = { executeArb };
