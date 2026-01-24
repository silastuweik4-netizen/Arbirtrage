require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-verify"); // ✅ Explicitly add the new verify plugin

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    base: {
      url: process.env.RPC_URL,
      accounts: [process.env.PRIVATE_KEY]
    }
  },
  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY // ✅ BaseScan API key goes here
    }
  }
};
