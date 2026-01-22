// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IPool {
    function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode) external;
}

contract EnhancedArb {
    address public constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address public owner;

    struct SwapStep {
        address target;
        bytes callData;
        address tokenIn;
        address tokenOut;
    }

    struct ArbParams {
        address asset;
        uint256 amount;
        SwapStep[] steps;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function executeArb(ArbParams calldata params) external onlyOwner {
        IPool(AAVE_POOL).flashLoanSimple(
            address(this),
            params.asset,
            params.amount,
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
    ) external returns (bool) {
        require(msg.sender == AAVE_POOL, "Only Aave");
        require(initiator == address(this), "Only this");

        ArbParams memory arbParams = abi.decode(params, (ArbParams));
        uint256 amountOwed = amount + premium;

        for (uint i = 0; i < arbParams.steps.length; i++) {
            SwapStep memory step = arbParams.steps[i];
            
            // Dynamic approval
            uint256 balanceIn = IERC20(step.tokenIn).balanceOf(address(this));
            IERC20(step.tokenIn).approve(step.target, balanceIn);

            // Execute swap
            (bool success, ) = step.target.call(step.callData);
            require(success, "Swap failed");
        }

        uint256 finalBalance = IERC20(asset).balanceOf(address(this));
        require(finalBalance >= amountOwed, "No profit");

        IERC20(asset).approve(AAVE_POOL, amountOwed);
        
        uint256 profit = finalBalance - amountOwed;
        if (profit > 0) {
            IERC20(asset).transfer(owner, profit);
        }

        return true;
    }

    function withdraw(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(owner, balance);
    }

    receive() external payable {}
}
