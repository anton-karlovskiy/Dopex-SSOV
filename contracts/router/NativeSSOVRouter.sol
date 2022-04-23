// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

// Libraries
import {SafeERC20} from '../external/libraries/SafeERC20.sol';

// Interfaces
import {IERC20} from '../external/interfaces/IERC20.sol';
import {IUniswapV2Router02} from '../interfaces/IUniswapV2Router02.sol';
import {INativeSSOV} from '../interfaces/INativeSSOV.sol';

contract NativeSSOVRouter {
    using SafeERC20 for IERC20;

    IUniswapV2Router02 public uniswapV2Router;
    INativeSSOV public ssov;

    address public wrappedNativeToken;

    struct PurchaseOption {
        uint256 strikeIndex;
        uint256 amount;
        address to;
    }

    /// @notice Constructor
    /// @param _ssov address of SSOV
    /// @param _uniswapV2Router address of Uniswap V2 Router
    constructor(
        address _ssov,
        address _uniswapV2Router,
        address _wrappedNativeToken
    ) {
        ssov = INativeSSOV(_ssov);
        uniswapV2Router = IUniswapV2Router02(_uniswapV2Router);
        wrappedNativeToken = _wrappedNativeToken;
    }

    receive() external payable {}

    /// @notice Swap any token to the quote asset, then purchase option
    /// @param _fromAmount amount of tokens to swap from
    /// @param _minAmountOut minimum amount of tokens to receive
    /// @param _tokenFrom token that is to be swapped from
    /// @param _params PurchaseOption struct parameters to purchase option
    function swapAndPurchase(
        uint256 _fromAmount,
        uint256 _minAmountOut,
        address _tokenFrom,
        PurchaseOption calldata _params
    ) external payable returns (bool) {
        IERC20 tokenFrom = IERC20(_tokenFrom);
        tokenFrom.safeTransferFrom(msg.sender, address(this), _fromAmount);
        tokenFrom.safeApprove(address(uniswapV2Router), _fromAmount);
        address[] memory path;
        path[0] = _tokenFrom;
        path[1] = wrappedNativeToken;
        uint256 amount = uniswapV2Router.swapExactTokensForETH(
            _fromAmount,
            _minAmountOut,
            path,
            address(this),
            block.timestamp
        )[path.length - 1];
        ssov.purchase{value: amount}(
            _params.strikeIndex,
            _params.amount,
            _params.to
        );
        if (address(this).balance > 0) {
            payable(msg.sender).transfer(address(this).balance);
        }
        return true;
    }

    /// @notice Swap any token to quote asset, then deposit quote
    /// @param _fromAmount amount of tokens to swap from
    /// @param _minAmountOut minimum amount of quote to receive
    /// @param _tokenFrom token that is to be swapped from
    /// @param _strikeIndex strike index to deposit to
    /// @param _to address to deposit on behalf of
    function swapAndDeposit(
        uint256 _fromAmount,
        uint256 _minAmountOut,
        address _tokenFrom,
        uint256 _strikeIndex,
        address _to
    ) external payable returns (bool) {
        IERC20 tokenFrom = IERC20(_tokenFrom);
        tokenFrom.safeTransferFrom(msg.sender, address(this), _fromAmount);
        tokenFrom.safeApprove(address(uniswapV2Router), _fromAmount);
        address[] memory path;
        path[0] = _tokenFrom;
        path[1] = wrappedNativeToken;

        uint256 swapAmount = uniswapV2Router.swapExactTokensForETH(
            _fromAmount,
            _minAmountOut,
            path,
            address(this),
            block.timestamp
        )[path.length - 1];

        ssov.deposit{value: swapAmount}(_strikeIndex, _to);

        return true;
    }
}
