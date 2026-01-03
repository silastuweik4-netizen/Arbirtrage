# 📄 Smart Contract Deployment Guide: ArbitrageFlashloan.sol

The `ArbitrageFlashloan.sol` contract is the core of the bot's execution logic. It must be deployed to the Base Network before the Node.js bot can be started.

## 1. Prerequisites

*   **Solidity Compiler**: You will need a development environment (like Hardhat or Foundry) or a web-based tool (like Remix) to compile and deploy the contract.
*   **ETH on Base**: You need a small amount of ETH on the Base Network to pay for the deployment gas fees.
*   **Contract Files**: Ensure you have the main contract file (`ArbitrageFlashloan.sol`) and all its dependencies (`contracts/`, `interfaces/`) ready.

## 2. Compilation

The contract is written in Solidity `^0.8.18`.

### Using Hardhat/Foundry (Recommended)

If you are using a local development environment, ensure your compiler version is set to `0.8.18` or higher.

1.  **Install Dependencies**: The contract imports from OpenZeppelin. You must install them first:
    \`\`\`bash
    npm install @openzeppelin/contracts
    # or
    forge install OpenZeppelin/openzeppelin-contracts
    \`\`\`
2.  **Compile**:
    \`\`\`bash
    npx hardhat compile
    # or
    forge build
    \`\`\`

### Using Remix (Web-based)

1.  Go to [Remix IDE](https://remix.ethereum.org/).
2.  Create a new workspace and upload the `ArbitrageFlashloan.sol` file along with the files in the `contracts/` and `interfaces/` folders to maintain the correct import structure.
3.  Navigate to the **Solidity Compiler** tab.
4.  Select the **Compiler Version** to **0.8.18** or later.
5.  Click **Compile ArbitrageFlashloan.sol**.

## 3. Deployment to Base Mainnet

### Using Remix

1.  Navigate to the **Deploy & Run Transactions** tab.
2.  In the **Environment** dropdown, select **Injected Provider - Metamask**.
3.  Ensure your Metamask wallet is connected to the **Base Mainnet**.
4.  Select the `ArbitrageFlashloan` contract from the dropdown.
5.  The contract has no constructor arguments, so you can leave the field blank.
6.  Click the **Deploy** button.
7.  Confirm the transaction in Metamask.

### Using Hardhat/Foundry

You will need to configure your deployment script to use a Base RPC endpoint and your private key.

1.  **Set Environment Variables**:
    \`\`\`bash
    export BASE_RPC_URL="[YOUR_BASE_RPC_URL]"
    export PRIVATE_KEY="[YOUR_DEPLOYER_PRIVATE_KEY]"
    \`\`\`
2.  **Run Deployment Script**: Execute your deployment script (e.g., `deploy.js` in Hardhat or a custom script in Foundry).

## 4. Post-Deployment: Update config.js

Once the transaction is confirmed on the Base Network, you will receive the contract address.

**Crucially, you must update the `config.js` file in your Node.js bot project with this new address:**

\`\`\`javascript
// config.js

contracts: {
    // ... other contracts
    arbitrageContract: '0x[YOUR_NEWLY_DEPLOYED_CONTRACT_ADDRESS]', // <-- UPDATE THIS
},
\`\`\`

After this step, your Node.js bot will be able to interact with your deployed flashloan contract and execute arbitrage trades.
