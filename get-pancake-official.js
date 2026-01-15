#!/usr/bin/env node
const { ethers } = require('ethers');
const RPC = 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0';
const provider = new ethers.JsonRpcProvider(RPC, 8453, { staticNetwork: true });

const FACTORY = '0x0Eb5847f518fEEf69f90a5Ef8d2AF0679F65a6EF';
const FACTORY_ABI = [
  'function quoter() view returns (address)',
  'function swapRouter() view returns (address)'
];

(async () => {
  const f = new ethers.Contract(FACTORY, FACTORY_ABI, provider);
  const quoter = await f.quoter();
  const router = await f.swapRouter();
  console.log('Official PancakeSwap V3 on Base');
  console.log('Quoter     :', quoter);
  console.log('SwapRouter :', router);
})();
