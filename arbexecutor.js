// arbexecutor.js
const { ethers } = require('ethers');
require('dotenv').config();

class ArbExecutor {
  constructor(provider) {
    this.provider = provider;
    this.signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    // Minimal ABI for flashloanAndArb
    this.contract = new ethers.Contract(
      process.env.ARB_CONTRACT_ADDRESS,
      [
        "function flashloanAndArb((uint8,uint8,address,address,address,address,address,uint256,uint256,uint256,uint24,uint24,bool,bool,address,address,address)) external"
      ],
      this.signer
    );
  }

  async atomicTwoLegSwap({ buyVenue, sellVenue, tokenIn, tokenOut, amountIn, minBuyOut, minSellOut, meta }) {
    // Map venue tags to codes
    const dexCode = (tag) => tag.startsWith('uniswap_v3') ? 1 : (tag.startsWith('uniswap_v2') ? 0 : 2);

    const params = {
      dexBuy: dexCode(buyVenue),
      dexSell: dexCode(sellVenue),
      routerBuy: meta.routerBuy,
      routerSell: meta.routerSell,
      tokenIn: tokenIn.address,
      tokenMid: tokenOut.address,
      tokenOut: tokenIn.address, // final back to tokenIn for repay
      amountIn: ethers.utils.parseUnits(String(amountIn), tokenIn.decimals),
      minBuyOut: ethers.utils.parseUnits(String(minBuyOut), tokenOut.decimals),
      minSellOut: ethers.utils.parseUnits(String(minSellOut), tokenIn.decimals),
      feeBuy: meta.feeBuy || 500,
      feeSell: meta.feeSell || 500,
      stableBuy: !!meta.stableBuy,
      stableSell: !!meta.stableSell,
      factoryBuy: meta.factoryBuy,
      factorySell: meta.factorySell,
      recipient: process.env.PROFIT_RECIPIENT || await this.signer.getAddress()
    };

    const tx = await this.contract.flashloanAndArb(params, { gasLimit: meta.gasLimit || 1_500_000 });
    const receipt = await tx.wait();
    console.log(`TX executed: ${receipt.transactionHash}`);
    return receipt;
  }
}

module.exports = ArbExecutor;
