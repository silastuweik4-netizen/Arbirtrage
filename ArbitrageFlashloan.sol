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

    address public constant AAVE_POOL        = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address public constant UNISWAP_ROUTER   = 0x2626664c2603336E57B271c5C0b26F421741e481;
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

    event ArbitrageExecuted(address token, uint256 profit);
    event FlashloanInitiated(address token, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function initiateFlashloan(TradeParams calldata params) external onlyOwner {
        address[] memory assets  = new address[](1);
        assets[0] = params.tokenBorrow;
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = params.amountBorrow;
        
        uint256[] memory modes   = new uint256[](1);
        modes[0] = 0;

        emit FlashloanInitiated(params.tokenBorrow, params.amountBorrow);

        IPool(AAVE_POOL).flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            abi.encode(params),
            0
        );
    }

    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == AAVE_POOL, "Caller must be Aave Pool");
        require(initiator == address(this), "Initiator must be this contract");

        TradeParams memory tradeParams = abi.decode(params, (TradeParams));
        
        address asset = assets[0];
        uint256 amount = amounts[0];
        uint256 premium = premiums[0];

        IERC20(tradeParams.tokenIn).safeApprove(UNISWAP_ROUTER, type(uint256).max);
        IERC20(tradeParams.tokenIn).safeApprove(AERODROME_ROUTER, type(uint256).max);
        IERC20(tradeParams.tokenOut).safeApprove(UNISWAP_ROUTER, type(uint256).max);
        IERC20(tradeParams.tokenOut).safeApprove(AERODROME_ROUTER, type(uint256).max);

        (bool successA, bytes memory retA) = AERODROME_ROUTER.call(tradeParams.swapDataA);
        if (!successA) (successA, retA) = UNISWAP_ROUTER.call(tradeParams.swapDataA);
        if (!successA) _revertBytes("Swap A", retA);

        (bool successB, bytes memory retB) = UNISWAP_ROUTER.call(tradeParams.swapDataB);
        if (!successB) (successB, retB) = AERODROME_ROUTER.call(tradeParams.swapDataB);
        if (!successB) _revertBytes("Swap B", retB);

        uint256 finalBalance = IERC20(asset).balanceOf(address(this));
        uint256 amountOwed = amount + premium;
        require(finalBalance >= amountOwed, "Insufficient to repay flashloan");

        uint256 profit = finalBalance - amountOwed;
        if (profit > 0) {
            emit ArbitrageExecuted(asset, profit);
            IERC20(asset).safeTransfer(owner, profit);
        }

        IERC20(asset).safeApprove(AAVE_POOL, amountOwed);
        return true;
    }

    function _revertBytes(string memory side, bytes memory ret) private pure {
        if (ret.length == 0) revert(string(abi.encodePacked(side, " low-level")));
        if (ret.length < 68) revert(string(abi.encodePacked(side, " unknown")));
        assembly { ret := add(ret, 0x04) }
        revert(string(abi.encodePacked(side, ": ", abi.decode(ret, (string)))));
    }

    function withdrawStuckTokens(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) IERC20(token).safeTransfer(owner, balance);
    }

    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) payable(owner).transfer(balance);
    }

    receive() external payable {}
}
