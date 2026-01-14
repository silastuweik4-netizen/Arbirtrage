// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

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
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transfer failed");
    }
    
    function safeApprove(IERC20 token, address spender, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(IERC20.approve.selector, spender, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: approve failed");
    }
}

interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

contract ArbitrageFlashloan is IFlashLoanSimpleReceiver {
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
        bytes swapDataA_Uni;
        bytes swapDataA_Aero;
        bytes swapDataB_Uni;
        bytes swapDataB_Aero;
    }

    event ArbitrageExecuted(address indexed token, uint256 profit);
    event FlashloanInitiated(address indexed token, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function initiateFlashloan(TradeParams calldata params) external onlyOwner {
        emit FlashloanInitiated(params.tokenBorrow, params.amountBorrow);

        IPool(AAVE_POOL).flashLoanSimple(
            address(this),
            params.tokenBorrow,
            params.amountBorrow,
            abi.encode(params),
            0
        );
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == AAVE_POOL, "Caller must be Aave Pool");
        require(initiator == address(this), "Initiator must be this contract");

        TradeParams memory tradeParams = abi.decode(params, (TradeParams));
        
        uint256 amountOwed = amount + premium;

        // FIXED: Exact approvals only (safer than max)
        IERC20(tradeParams.tokenIn).safeApprove(UNISWAP_ROUTER, amount);
        IERC20(tradeParams.tokenIn).safeApprove(AERODROME_ROUTER, amount);
        IERC20(tradeParams.tokenOut).safeApprove(UNISWAP_ROUTER, 0); // Reset first
        IERC20(tradeParams.tokenOut).safeApprove(AERODROME_ROUTER, 0);
        IERC20(tradeParams.tokenOut).safeApprove(UNISWAP_ROUTER, type(uint256).max); // Then approve max for output (if needed)
        IERC20(tradeParams.tokenOut).safeApprove(AERODROME_ROUTER, type(uint256).max);

        // FIXED: Use separate calldata, try preferred router first
        (bool successA, ) = UNISWAP_ROUTER.call(tradeParams.swapDataA_Uni);
        if (!successA && tradeParams.swapDataA_Aero.length > 0) {
            (successA, ) = AERODROME_ROUTER.call(tradeParams.swapDataA_Aero);
        }
        require(successA, "Swap A failed both routes");

        (bool successB, ) = AERODROME_ROUTER.call(tradeParams.swapDataB_Aero);
        if (!successB && tradeParams.swapDataB_Uni.length > 0) {
            (successB, ) = UNISWAP_ROUTER.call(tradeParams.swapDataB_Uni);
        }
        require(successB, "Swap B failed both routes");

        uint256 finalBalance = IERC20(asset).balanceOf(address(this));
        require(finalBalance >= tradeParams.minAmountOut, "Profit too low / slippage too high");
        require(finalBalance >= amountOwed, "Insufficient to repay flashloan");

        IERC20(asset).safeApprove(AAVE_POOL, amountOwed);

        uint256 profit = finalBalance - amountOwed;
        if (profit > 0) {
            emit ArbitrageExecuted(asset, profit);
            IERC20(asset).safeTransfer(owner, profit);
        }

        return true;
    }

    function withdrawStuckTokens(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).safeTransfer(owner, balance);
        }
    }

    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            payable(owner).transfer(balance);
        }
    }

    receive() external payable {}
}
