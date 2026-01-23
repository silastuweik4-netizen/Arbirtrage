# Flashloan Integration Guide

This document explains how to integrate your deployed flashloan contract with the arbitrage bot.

## Overview

The arbitrage bot detects price discrepancies across DEXs and can automatically execute trades using flashloans. This guide helps you:

1. Provide the correct contract ABI
2. Configure the bot to execute trades
3. Test the integration safely

## Prerequisites

- **Deployed Flashloan Contract** on Base Chain
- **Contract ABI** (JSON format)
- **Contract Address** (hex format: `0x...`)
- **Wallet with ETH** for gas fees (at least 0.1 ETH)

## Step 1: Get Your Contract ABI

### Option A: From Basescan (Verified Contract)

If your contract is verified on [Basescan](https://basescan.org):

1. Go to [basescan.org](https://basescan.org)
2. Search for your contract address
3. Click the **Contract** tab
4. Scroll to **Contract ABI**
5. Click **Copy** to copy the ABI
6. Save to `contracts/FlashloanABI.json`

### Option B: From Hardhat Artifacts

If you deployed using Hardhat:

```bash
# The ABI is in the artifacts directory
cp artifacts/contracts/YourContract.sol/YourContract.json contracts/FlashloanABI.json
```

### Option C: Manual ABI Creation

If you only have the contract source, extract the ABI:

```javascript
// Example ABI for a flashloan contract
const FLASHLOAN_ABI = [
  "function executeArbitrage(address tokenIn, address tokenOut, uint256 amountIn, address[] memory path, uint256 profitThreshold) external",
  "function flashloan(address token, uint256 amount) external",
  "function withdraw(address token, uint256 amount) external",
  "event ArbitrageExecuted(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 profit)"
];
```

## Step 2: Update the Bot Configuration

### 2.1 Add Contract ABI to detector.js

Replace the placeholder ABI in `detector.js`:

```javascript
// BEFORE (placeholder):
const FLASHLOAN_ABI = [
    "function executeArbitrage(address tokenIn, address tokenOut, uint256 amountIn, address[] memory path, uint256 profitThreshold) external",
    "function flashloan(address token, uint256 amount) external"
];

// AFTER (your actual ABI):
const FLASHLOAN_ABI = [
    // Paste your actual contract ABI here
    // Example:
    "function executeArbitrage(address tokenIn, address tokenOut, uint256 amountIn, address[] memory path, uint256 minProfitBps) external returns (uint256)",
    "function flashloan(address token, uint256 amount, bytes calldata data) external",
    "function withdraw(address token) external",
    "event ArbitrageExecuted(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 profit)"
];
```

### 2.2 Set Environment Variables

Create a `.env` file with your contract details:

```env
# Flashloan Configuration
PRIVATE_KEY=0x...  # Your wallet private key (hex format)
FLASHLOAN_CONTRACT_ADDRESS=0x...  # Your contract address
GAS_LIMIT=500000  # Adjust based on your contract's needs
```

### 2.3 Verify Configuration

Test that the bot can connect to your contract:

```bash
# Install dependencies
npm install

# Run the bot (it will attempt to connect to your contract)
npm start
```

You should see in the logs:
```
Flashloan executor initialized with contract: 0x...
```

## Step 3: Understand the Execution Flow

### Current Implementation

The bot currently implements a simplified execution flow:

```
1. Detect Arbitrage Opportunity
   ↓
2. Identify Best Buy/Sell DEXes
   ↓
3. Call Contract.executeArbitrage()
   ↓
4. Contract executes flashloan and trades
   ↓
5. Profit returned to wallet
```

### Expected Contract Function Signature

Your contract should have a function like:

```solidity
function executeArbitrage(
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    address[] memory path,
    uint256 profitThreshold
) external returns (uint256 profit)
```

**Parameters:**
- `tokenIn`: Token to start with (e.g., WETH)
- `tokenOut`: Token to end with (e.g., USDC)
- `amountIn`: Amount of tokenIn to use
- `path`: Array of DEX routers/pools to use
- `profitThreshold`: Minimum profit in basis points (bps)

**Returns:**
- `profit`: Actual profit in tokenOut

## Step 4: Customize the Execution Logic

### 4.1 Modify executeFlashloan() Function

The `executeFlashloan()` function in `detector.js` needs to be customized for your contract:

```javascript
async executeFlashloan(pair, spreadData) {
    if (!this.flashloanContract) {
        console.warn("Flashloan execution is disabled.");
        return;
    }

    console.log(`⚡️ Executing Flashloan for ${pair.t0.name}/${pair.t1.name}...`);

    const tokenIn = pair.t0.address;
    const tokenOut = pair.t1.address;
    const amountIn = ethers.utils.parseUnits(CONFIG.TRADE_SIZE, pair.t0.decimals);
    
    // Construct the path based on your contract's requirements
    // This is a simplified example - adjust based on your contract logic
    const path = [
        DEX_ADDRESSES.UNISWAP_V2_ROUTER,
        DEX_ADDRESSES.AERODROME_ROUTER
    ];

    try {
        const tx = await this.flashloanContract.executeArbitrage(
            tokenIn,
            tokenOut,
            amountIn,
            path,
            ethers.utils.parseUnits(spreadData.diff.toFixed(2), 2),
            {
                gasLimit: CONFIG.GAS_LIMIT,
            }
        );

        console.log(`Transaction: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`Confirmed in block ${receipt.blockNumber}`);
        console.log(`Gas used: ${receipt.gasUsed.toString()}`);

    } catch (error) {
        console.error(`Execution failed: ${error.message}`);
    }
}
```

### 4.2 Update Path Construction

If your contract requires specific pool addresses instead of router addresses:

```javascript
// Instead of router addresses, use pool addresses
const path = [
    '0x...', // Pool address for WETH/USDC on Uniswap V3
    '0x...'  // Pool address for USDC/AERO on Aerodrome
];
```

## Step 5: Test the Integration

### 5.1 Local Testing

```bash
# Set up environment
cp .env.example .env
# Edit .env with your contract details

# Run the bot
npm start
```

### 5.2 Monitor Execution

Watch the logs for:
- `🎯 VERIFIED` - Opportunity detected
- `⚡️ Executing Flashloan` - Trade being executed
- `Transaction:` - Transaction hash
- `Confirmed in block` - Trade succeeded
- `❌ Execution failed` - Error details

### 5.3 Check Transaction on Basescan

1. Copy the transaction hash from logs
2. Go to [basescan.org](https://basescan.org)
3. Paste the transaction hash
4. Verify the trade details and profit

## Step 6: Production Deployment

### 6.1 Security Checklist

- [ ] Private key is secure and not in version control
- [ ] Contract has been audited (recommended)
- [ ] Contract has been tested on testnet
- [ ] Wallet has sufficient ETH for gas
- [ ] Gas limit is appropriate for your contract
- [ ] Profit threshold is realistic

### 6.2 Deploy to Render

```bash
git add .
git commit -m "Integrate flashloan contract"
git push origin main
```

Update environment variables in Render dashboard:
- `PRIVATE_KEY`
- `FLASHLOAN_CONTRACT_ADDRESS`
- `GAS_LIMIT`

## Step 7: Troubleshooting

### Issue: "Flashloan executor initialized but no transactions"

**Possible causes:**
- Opportunities are too small (below threshold)
- Contract address is incorrect
- Contract doesn't have the expected function

**Solutions:**
1. Lower `PRICE_DIFFERENCE_THRESHOLD` to `0.1`
2. Verify contract address on Basescan
3. Check contract ABI matches actual contract

### Issue: "Execution failed: revert"

**Possible causes:**
- Insufficient balance in contract
- Path is incorrect
- Profit threshold too high
- Contract logic error

**Solutions:**
1. Check contract balance
2. Verify path construction
3. Lower profit threshold
4. Review contract source code

### Issue: "Gas limit too low"

**Solution:**
Increase `GAS_LIMIT` in `.env`:

```env
GAS_LIMIT=1000000  # Increase from 500000
```

## Step 8: Advanced Customization

### 8.1 Custom Path Construction

If your contract uses a custom path format:

```javascript
// Example: Custom path with fee tiers for Uniswap V3
const path = ethers.utils.solidityPacked(
    ['address', 'uint24', 'address', 'uint24', 'address'],
    [
        TOKENS.WETH.address,
        3000,  // 0.3% fee tier
        TOKENS.USDC.address,
        500,   // 0.05% fee tier
        TOKENS.AERO.address
    ]
);
```

### 8.2 Multi-Hop Arbitrage

If your contract supports multi-hop paths:

```javascript
const path = [
    TOKENS.WETH.address,
    TOKENS.USDC.address,
    TOKENS.AERO.address,
    TOKENS.WETH.address  // Return to original token
];
```

### 8.3 Event Listening

Listen for execution events:

```javascript
this.flashloanContract.on('ArbitrageExecuted', (tokenIn, tokenOut, amountIn, amountOut, profit) => {
    console.log(`Arbitrage executed: ${amountIn} ${tokenIn} → ${amountOut} ${tokenOut}, Profit: ${profit}`);
});
```

## Reference: Expected Contract Interface

```solidity
// Minimal interface your contract should implement
interface IArbitrageFlashloan {
    function executeArbitrage(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address[] memory path,
        uint256 profitThreshold
    ) external returns (uint256 profit);
    
    function flashloan(
        address token,
        uint256 amount,
        bytes calldata data
    ) external;
    
    event ArbitrageExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 profit
    );
}
```

## Support

For contract-specific issues:
1. Review your contract source code
2. Verify function signatures match
3. Check Basescan for contract details
4. Test contract functions directly with Etherscan

---

**Need help?** Provide your contract ABI and address for further assistance.
