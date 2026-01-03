// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IAerodromeRouter.sol";
import "./interfaces/IUniswapV3Router.sol"; // Updated interface name
import "./interfaces/IAaveFlashloan.sol";

contract ArbitrageFlashloan {
    using SafeERC20 for IERC20;

    address public immutable owner;
    address public immutable AAVE_POOL = 0x693f035222014498895779089028919022378873; // Example Aave V3 Pool on Base
    address public immutable AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address public immutable UNISWAP_ROUTER = 0x68b3465833fb72A70ecDF485E0e4C6577D68987e; // Uniswap V3 Router 2

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // Struct to hold all trade parameters passed from the bot
    struct TradeParams {
        address tokenBorrow;
        uint256 amountBorrow;
        address tokenIn;
        address tokenOut;
        uint256 minAmountOut; // The on-chain slippage guard
        bytes swapDataA; // Encoded data for Swap A (e.g., Aerodrome)
        bytes swapDataB; // Encoded data for Swap B (e.g., Uniswap)
    }

    // Fallback function to receive ETH
    receive() external payable {}

    // 1. Initiate the flashloan
    function initiateFlashloan(TradeParams memory params) external onlyOwner {
        // Approve the Aave Pool to spend the tokenBorrow (for repayment)
        IERC20(params.tokenBorrow).safeApprove(AAVE_POOL, params.amountBorrow);

        // Calculate the fee (0.05%)
        uint256 fee = (params.amountBorrow * 5) / 10000;
        uint256 totalRepay = params.amountBorrow + fee;

        // Ensure the contract has enough ETH for gas and potential fees
        require(address(this).balance >= 0.001 ether, "Insufficient ETH for gas");

        // Call the Aave Pool
        IAaveFlashloan(AAVE_POOL).flashLoanSimple(
            address(this),
            params.tokenBorrow,
            params.amountBorrow,
            totalRepay,
            abi.encode(params) // Pass all trade parameters to the executeOperation callback
        );
    }

    // 2. Aave calls this function to execute the trade
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        // Decode the trade parameters
        TradeParams memory tradeParams = abi.decode(params, (TradeParams));

        // Sanity check: ensure the borrowed asset and amount match
        require(asset == tradeParams.tokenBorrow && amount == tradeParams.amountBorrow, "Invalid flashloan parameters");

        // --- 1. Execute Swap A (e.g., Aerodrome) ---
        // The swapDataA should contain the full calldata for the swap function
        (bool successA, ) = AERODROME_ROUTER.call(tradeParams.swapDataA);
        require(successA, "Swap A failed");

        // --- 2. Execute Swap B (e.g., Uniswap V3) ---
        // The swapDataB should contain the full calldata for the swap function
        (bool successB, ) = UNISWAP_ROUTER.call(tradeParams.swapDataB);
        require(successB, "Swap B failed");

        // --- 3. Slippage Guard Enforcement ---
        // After the final swap, check the balance of the borrowed token
        uint256 finalBalance = IERC20(tradeParams.tokenBorrow).balanceOf(address(this));
        
        // The core MEV protection: ensure the final balance is greater than the required repayment + minAmountOut
        require(finalBalance >= amount + premium + tradeParams.minAmountOut, "Slippage guard triggered or insufficient profit");

        // 4. Repay the flashloan
        IERC20(asset).safeTransfer(AAVE_POOL, amount + premium);

        // 5. Send profit to the owner
        uint256 profit = IERC20(asset).balanceOf(address(this));
        if (profit > 0) {
            IERC20(asset).safeTransfer(owner, profit);
        }

        return true;
    }

    // Function to withdraw any stuck tokens (only callable by owner)
    function withdrawStuckTokens(address token) external onlyOwner {
        IERC20(token).safeTransfer(owner, IERC20(token).balanceOf(address(this)));
    }
}
