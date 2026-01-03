# 🚀 Base Network Arbitrage Bot: Flashloan Engine

This is a high-frequency, zero-capital arbitrage bot designed to exploit rate discrepancies between **Uniswap V3** and **Aerodrome** on the **Base Network**. It is built for production use, featuring flashloan integration, dynamic trade sizing, and MEV protection.

## ✨ Key Features

*   **Zero-Capital Arbitrage**: Full integration with **Aave V3 Flashloans** (0.05% fee) to execute trades without requiring initial capital.
*   **Comprehensive Coverage**: Monitors **55+ trading pairs** across four major categories: Wrapped Assets, Staked Assets, Stablecoins, and high-frequency Ecosystem Tokens (e.g., AERO, AXL, BRETT).
*   **MEV Protection**: Designed to use **private RPC endpoints** for transaction submission, bypassing the public mempool to prevent front-running.
*   **Dynamic Optimization**: Auto-calculates the optimal trade size to maximize net profit while accounting for slippage, flashloan fees, and gas costs.
*   **On-Chain Slippage Guard**: The Solidity smart contract includes a minimum profit threshold to automatically revert unprofitable trades.

## ⚙️ Prerequisites

1.  **Node.js**: Version 18+
2.  **Solidity Compiler**: For deploying the smart contract.
3.  **Base Network RPC**: A reliable RPC endpoint. **For execution, a private RPC endpoint is highly recommended.**
4.  **Wallet**: An Ethereum wallet with a small amount of ETH for gas fees.

## 🛠️ Setup and Installation

1.  **Clone the Repository**
    \`\`\`bash
    git clone [YOUR_REPO_URL]
    cd base-arbitrage-bot
    \`\`\`

2.  **Install Dependencies**
    \`\`\`bash
    npm install
    \`\`\`

3.  **Smart Contract Deployment (Crucial Step)**
    The bot requires the address of the deployed `ArbitrageFlashloan.sol` contract. This contract handles the atomic flashloan and swap logic.
    *   **Deploy `ArbitrageFlashloan.sol`** to the Base Network.
    *   **Copy the deployed address.**

4.  **Configuration**
    Open `config.js` and update the following critical fields:

    | Field | Description | Example Value |
    | :--- | :--- | :--- |
    | `contracts.arbitrageContract` | **Your deployed contract address.** | `0x1234...abcd` |
    | `PRIVATE_RPC_URL` | **Private RPC endpoint** for MEV protection. | `https://private.rpc.com/key` |
    | `PRIVATE_KEY` | The private key of your wallet (used to pay gas and receive profit). | `0xdeadbeef...` |

## ▶️ Running the Bot

### 1. One-Time Scan (Testing)

Use the dedicated scan script to check for current opportunities without running the continuous monitor.

\`\`\`bash
node scan-55-pairs.js
\`\`\`

### 2. Continuous Monitoring and Execution

This command starts the bot in its continuous loop, checking for arbitrage opportunities every 10 seconds (configurable in `config.js`) and executing trades that exceed the `$5.00` execution threshold.

\`\`\`bash
npm start
# or
node index.js
\`\`\`

## 📂 Project Structure

| File/Folder | Description |
| :--- | :--- |
| `index.js` | Main entry point for the bot. |
| `bot.js` | Core logic: price fetching, profit calculation, execution encoding. |
| `config.js` | All token addresses, pairs, contract addresses, and bot settings. |
| `abis.js` | JavaScript ABIs for DEX contracts (Uniswap V3 Quoter, Aerodrome Router). |
| `scan-55-pairs.js` | Utility script for a single, comprehensive scan. |
| `ArbitrageFlashloan.sol` | **Solidity Contract**: Handles Aave V3 flashloan and atomic swaps. |
| `contracts/` | Solidity dependency files (e.g., `IERC20.sol`, `SafeERC20.sol`). |
| `interfaces/` | Solidity interfaces for external protocols (Aave, DEXs). |
| `FINAL_55_PAIR_SCAN_REPORT.md` | Report on the latest comprehensive scan results. |
| `package.json` | Project dependencies (`ethers.js`, `chalk`). |
