const { ethers } = require("ethers");
require("dotenv").config();

// Env vars
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.ARB_CONTRACT_ADDRESS;

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// ABI for ArbExecutor
const ABI = [
  "function flashloanAndArb((uint8,uint8,address,address,address,address,address,uint256,uint256,uint256,uint24,uint24,bool,bool,address,address,address)) external"
];

async function main() {
  if (!CONTRACT_ADDRESS) throw new Error("ARB_CONTRACT_ADDRESS not set");

  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  // Minimal params for dry-run style test
  const params = {
    dexBuy: 1,
    dexSell: 1,
    routerBuy: ethers.constants.AddressZero,
    routerSell: ethers.constants.AddressZero,
    tokenIn: ethers.constants.AddressZero,
    tokenMid: ethers.constants.AddressZero,
    tokenOut: ethers.constants.AddressZero,
    amountIn: 0,
    minBuyOut: 0,
    minSellOut: 0,
    feeBuy: 3000,
    feeSell: 3000,
    stableBuy: false,
    stableSell: false,
    factoryBuy: ethers.constants.AddressZero,
    factorySell: ethers.constants.AddressZero,
    recipient: wallet.address
  };

  console.log("Sending test tx to contract:", CONTRACT_ADDRESS);
  const tx = await contract.flashloanAndArb(params);
  console.log("Tx hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);
}

main().catch(err => {
  console.error("Execution test failed:", err);
});
