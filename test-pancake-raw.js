#!/usr/bin/env node
/*
 * Raw low-level call to PancakeSwap V3 quoter – Base main-net
 * Tests USDC → USDbC (0.01 % fee) – pool EXISTS
 */
require('dotenv').config();
const { ethers } = require('ethers');
const config     = require('./config');

(async () => {
  const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL, config.CHAIN_ID, { staticNetwork: true });

  const PANCAKE_QUOTER = '0x0eb1b7bdbe6a5ae0cb1f5e2d13b70d1027b5fd5a';

  // USDC → USDbC (0.01 % pool – live on Pancake V3 Base) ------------------------
  const tokenIn  = config.tokens.USDC.address;
  const tokenOut = config.tokens.USDbC.address;
  const fee      = 100; // 0.01 %
  const amountIn = ethers.parseUnits('1000', 6); // 1000 USDC

  // selector for quoteExactInputSingle(address,address,uint24,uint256,uint160)
  const selector = ethers.id('quoteExactInputSingle(address,address,uint24,uint256,uint160)').slice(0,10);

  // abi-encode the arguments
  const args = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address','address','uint24','uint256','uint160'],
    [tokenIn, tokenOut, fee, amountIn, 0]
  );

  const payload = selector + args.slice(2);

  console.log('RPC        :', config.BASE_RPC_URL);
  console.log('Quoter     :', PANCAKE_QUOTER);
  console.log('Token pair :', `${tokenIn} → ${tokenOut}  fee ${fee}`);
  console.log('Calldata   :', payload);
  console.log('----------------------------------------');

  try {
    const raw = await provider.call({ to: PANCAKE_QUOTER, data: payload });
    console.log('Raw return :', raw);

    if (raw && raw !== '0x') {
      const [amountOut] = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], raw);
      console.log('Decoded    :', ethers.formatUnits(amountOut, 6), 'USDbC');
    } else {
      console.log('Empty return – pool does NOT exist at this fee');
    }
  } catch (e) {
    console.log('Raw revert :', e.shortMessage || e.message);
    if (e.data) console.log('Revert data:', e.data);
  }
})();
