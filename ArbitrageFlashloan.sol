// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

// --- INTERFACES ---

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transfer failed");
    }
}

interface IAaveFlashloan {
    function flashLoanSimple(
        address receiver,
        address asset,
        uint256 amount,
        uint256 premium,
        bytes calldata params
    ) external returns (bool);
}

// --- MAIN CONTRACT ---

contract ArbitrageFlashloan {
    using SafeERC20 for IERC20;

    // Base Network Addresses (Checksum Corrected)
    address public constant AAVE_POOL = 0xa238Dd80C259A72e81d7e4674A983677f1122524;
    address public constant UNISWAP_ROUTER = 0x2626664C2603381e5C8D3d9a97E067A20EE708EE;
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

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // 1. The bot calls this function to start the arbitrage
    function initiateFlashloan(TradeParams calldata params) external onlyOwner {
        // Approve Aave to take back the funds
        IERC20(params.tokenBorrow).approve(AAVE_POOL, type(uint256).max);

        // Call the Aave Pool
        IAaveFlashloan(AAVE_POOL).flashLoanSimple(
            address(this),
            params.tokenBorrow,
            params.amountBorrow,
            0, 
            abi.encode(params)
        );
    }

    // 2. Aave calls this function to execute the trade
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address, // initiator (unused)
        bytes calldata params
    ) external returns (bool) {
        TradeParams memory tradeParams = abi.decode(params, (TradeParams));
        
        // --- 1. Execute Swap A ---
        (bool successA, ) = AERODROME_ROUTER.call(tradeParams.swapDataA);
        if (!successA) {
            (successA, ) = UNISWAP_ROUTER.call(tradeParams.swapDataA);
        }
        require(successA, "Swap A failed");

        // --- 2. Execute Swap B ---
        (bool successB, ) = UNISWAP_ROUTER.call(tradeParams.swapDataB);
        if (!successB) {
            (successB, ) = AERODROME_ROUTER.call(tradeParams.swapDataB);
        }
        require(successB, "Swap B failed");

        // --- 3. Slippage Guard ---
        uint256 finalBalance = IERC20(tradeParams.tokenBorrow).balanceOf(address(this));
        require(finalBalance >= amount + premium + tradeParams.minAmountOut, "Insufficient profit");

        // 4. Repay the flashloan
        IERC20(asset).safeTransfer(AAVE_POOL, amount + premium);

        // 5. Send profit to the owner
        uint256 profit = IERC20(asset).balanceOf(address(this));
        if (profit > 0) {
            IERC20(asset).safeTransfer(owner, profit);
        }

        return true;
    }

    function withdrawStuckTokens(address token) external onlyOwner {
        IERC20(token).safeTransfer(owner, IERC20(token).balanceOf(address(this)));
    }

    receive() external payable {}
}
