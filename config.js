const { ethers } = require('ethers');
const addr = (a) => ethers.getAddress(a);

module.exports = {
  BASE_RPC_URL: process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/c9sgWYXHHHwxgwSSDwR6gP8PWB5MuTQ0',
  CHAIN_ID: 8453,

  contracts: {
    aerodromeRouter: addr('0xcF77a3Ba9A5CA399B7c97c74d6e6b1aba2327f27'),   // official Base
    aerodromeFactory:addr('0x5C7363fF8eA0D7f0c5B5ef38aC925a6aac87300a')     // official Base
  },

  tokens: {
    USDC:  { address: addr('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'), decimals: 6 , symbol: 'USDC' },
    USDbC: { address: addr('0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'), decimals: 6 , symbol: 'USDbC' }
  },

  // factory-verified pools -------------------------------------------------------
  pools: {
    USDC_USDbC_volatile: addr('0xdf5834359cc81063910a9C78b11E686B99105d66'), // 0.3 %
    USDC_USDbC_stable:   addr('0x172bD67fD1287dC5355113532f7D3163C5f23F5B')  // 0.04 %
  },

  settings: {
    scanInterval: 2_000,        // ms
    spreadBpsThreshold: 5,      // 0.05 %
    testAmount: '1000'          // USDC
  }
};
