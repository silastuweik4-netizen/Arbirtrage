const { ethers } = require('ethers');
const fs = require('fs');

// Your fixed contract source code
const contractSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed");
    }
    function safeApprove(IERC20 token, address spender, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(IERC20.approve.selector, spender, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Approve failed");
    }
}

interface IPool {
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata interestRateModes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IFlashLoanReceiver {
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

contract ArbitrageFlashloan is IFlashLoanReceiver {
    using SafeERC20 for IERC20;
    
    address public constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address public constant UNISWAP_ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;
    address public constant AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address public owner;
    
    struct TradeParams {
        address tokenBorrow;
        uint256 amountBorrow;
        address tokenIn;
        address tokenOut;
        uint256 minAmountOut;
        bytes swapDataA;
        bytes swapDataB;
    }
    
    modifier onlyOwner() { require(msg.sender == owner); _; }
    constructor() { owner = msg.sender; }
    
    function initiateFlashloan(TradeParams calldata params) external onlyOwner {
        address[] memory assets = new address[](1);
        assets[0] = params.tokenBorrow;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = params.amountBorrow;
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0;
        IPool(AAVE_POOL).flashLoan(address(this), assets, amounts, modes, address(this), abi.encode(params), 0);
    }
    
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == AAVE_POOL);
        TradeParams memory tradeParams = abi.decode(params, (TradeParams));
        address asset = assets[0];
        uint256 amount = amounts[0];
        uint256 premium = premiums[0];
        
        IERC20(tradeParams.tokenIn).safeApprove(UNISWAP_ROUTER, type(uint256).max);
        IERC20(tradeParams.tokenIn).safeApprove(AERODROME_ROUTER, type(uint256).max);
        IERC20(tradeParams.tokenOut).safeApprove(UNISWAP_ROUTER, type(uint256).max);
        IERC20(tradeParams.tokenOut).safeApprove(AERODROME_ROUTER, type(uint256).max);
        
        (bool successA,) = AERODROME_ROUTER.call(tradeParams.swapDataA);
        if (!successA) (successA,) = UNISWAP_ROUTER.call(tradeParams.swapDataA);
        require(successA, "Swap A failed");
        
        (bool successB,) = UNISWAP_ROUTER.call(tradeParams.swapDataB);
        if (!successB) (successB,) = AERODROME_ROUTER.call(tradeParams.swapDataB);
        require(successB, "Swap B failed");
        
        uint256 finalBalance = IERC20(asset).balanceOf(address(this));
        uint256 amountOwed = amount + premium;
        require(finalBalance >= amountOwed, "Insufficient to repay");
        
        IERC20(asset).safeApprove(AAVE_POOL, amountOwed);
        
        uint256 profit = finalBalance - amountOwed;
        if (profit > 0) IERC20(asset).safeTransfer(owner, profit);
        
        return true;
    }
    
    function withdrawStuckTokens(address token) external onlyOwner {
        IERC20(token).safeTransfer(owner, IERC20(token).balanceOf(address(this)));
    }
    
    receive() external payable {}
}
`;

async function main() {
    console.log("\n🚀 DEPLOYING FIXED ARBITRAGE CONTRACT\n");

    // Check if solc is available
    let solc;
    try {
        solc = require('solc');
        console.log("✅ Solidity compiler found");
    } catch (e) {
        console.error("❌ ERROR: solc not installed!");
        console.log("\nRun: npm install solc");
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(
        process.env.BASE_RPC_URL || 'https://base-rpc.publicnode.com',
        8453
    );

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.error("❌ ERROR: PRIVATE_KEY not set!");
        process.exit(1);
    }

    const wallet = new ethers.Wallet(privateKey, provider);
    console.log("📍 Deploying from:", wallet.address);

    const balance = await provider.getBalance(wallet.address);
    console.log("💰 Balance:", ethers.formatEther(balance), "ETH\n");

    if (balance < ethers.parseEther('0.002')) {
        console.error("❌ Need at least 0.002 ETH for deployment");
        process.exit(1);
    }

    // Compile
    console.log("⏳ Compiling contract...");
    const input = {
        language: 'Solidity',
        sources: { 'ArbitrageFlashloan.sol': { content: contractSource } },
        settings: {
            optimizer: { enabled: true, runs: 200 },
            outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } }
        }
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    
    if (output.errors) {
        const errors = output.errors.filter(e => e.severity === 'error');
        if (errors.length > 0) {
            console.error('❌ Compilation errors:', errors);
            process.exit(1);
        }
    }

    const contract = output.contracts['ArbitrageFlashloan.sol']['ArbitrageFlashloan'];
    const abi = contract.abi;
    const bytecode = '0x' + contract.evm.bytecode.object;

    console.log("✅ Compiled successfully!\n");

    // Deploy
    console.log("⏳ Deploying to Base...");
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    const deployedContract = await factory.deploy();
    
    console.log("📤 TX:", deployedContract.deploymentTransaction().hash);
    console.log("⏳ Waiting for confirmation...\n");
    
    await deployedContract.waitForDeployment();
    const address = await deployedContract.getAddress();

    console.log("=" .repeat(70));
    console.log("✅ DEPLOYMENT SUCCESSFUL!");
    console.log("=".repeat(70));
    console.log("\n📍 Contract Address:", address);
    console.log("👤 Owner:", wallet.address);
    console.log("🔗 BaseScan:", `https://basescan.org/address/${address}`);
    console.log("\n" + "=".repeat(70));
    console.log("📝 UPDATE config.js:");
    console.log("=".repeat(70));
    console.log(`
contracts: {
    arbitrageContract: '${address.toLowerCase()}',
    uniswapQuoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'.toLowerCase(),
    aerodromeRouter: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'.toLowerCase(),
    aerodromeFactory: '0x420dd381b31aef6683db6b902084cb0ffece40da'.toLowerCase()
}
    `);
    console.log("=".repeat(70) + "\n");

    fs.writeFileSync('DEPLOYED_ADDRESS.txt', address);
    console.log("💾 Address saved to DEPLOYED_ADDRESS.txt\n");
}

main().catch(error => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
});
