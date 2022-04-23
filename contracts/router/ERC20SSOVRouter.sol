// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

// Libraries
import {SafeERC20} from '../external/libraries/SafeERC20.sol';

// Interfaces
import {IERC20} from '../external/interfaces/IERC20.sol';
import {IUniswapV2Router02} from '../interfaces/IUniswapV2Router02.sol';
import {IERC20SSOV} from '../interfaces/IERC20SSOV.sol';

contract ERC20SSOVRouter {
    using SafeERC20 for IERC20;

    IUniswapV2Router02 public immutable uniswapV2Router;
    IERC20SSOV public immutable ssov;
    IERC20 public immutable ssovToken;

    address public immutable wrappedNativeToken;

    struct PurchaseOption {
        uint256 strikeIndex;
        uint256 amount;
        address to;
    }

    /// @notice Constructor
    /// @param _ssov address of SSOV
    /// @param _ssovToken address of the token of the SSOV
    /// @param _uniswapV2Router address of Uniswap V2 Router
    /// @param _weth address of WETH contract
    constructor(
        address _ssov,
        address _ssovToken,
        address _uniswapV2Router,
        address _weth
    ) {
        ssov = IERC20SSOV(_ssov);
        ssovToken = IERC20(_ssovToken);
        uniswapV2Router = IUniswapV2Router02(_uniswapV2Router);
        wrappedNativeToken = _weth;
    }

    receive() external payable {
        assert(msg.sender == wrappedNativeToken); // only accept Native token via fallback from the Wrapped Native token contract
    }

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
    ) external returns (bool) {
        IERC20 tokenFrom = IERC20(_tokenFrom);
        tokenFrom.safeTransferFrom(msg.sender, address(this), _fromAmount);
        tokenFrom.safeApprove(address(uniswapV2Router), _fromAmount);
        address[] memory path;
        if (_tokenFrom == wrappedNativeToken) {
            path = new address[](2);
            path[0] = wrappedNativeToken;
            path[1] = address(ssovToken);
        } else {
            path = new address[](3);
            path[0] = _tokenFrom;
            path[1] = wrappedNativeToken;
            path[2] = address(ssovToken);
        }
        uint256 ssovTokenAmount = uniswapV2Router.swapExactTokensForTokens(
            _fromAmount,
            _minAmountOut,
            path,
            address(this),
            block.timestamp
        )[path.length - 1];
        ssovToken.safeIncreaseAllowance(address(ssov), ssovTokenAmount);
        ssov.purchase(_params.strikeIndex, _params.amount, _params.to);
        _transferLeftoverBalance();
        return true;
    }

    /// @notice Swap native token to the quote asset, then purchase option
    /// @param _fromAmount amount of native token to swap from
    /// @param _minAmountOut minimum amount of tokens to receive
    /// @param _params PurchaseOption struct parameters to purchase option
    function swapNativeAndPurchase(
        uint256 _fromAmount,
        uint256 _minAmountOut,
        PurchaseOption calldata _params
    ) external payable returns (bool) {
        address[] memory path;
        path[0] = wrappedNativeToken;
        path[1] = address(ssovToken);
        uint256 ssovTokenAmount = uniswapV2Router.swapETHForExactTokens{
            value: _fromAmount
        }(_minAmountOut, path, address(this), block.timestamp)[1];
        ssovToken.safeIncreaseAllowance(address(ssov), ssovTokenAmount);
        ssov.purchase(_params.strikeIndex, _params.amount, _params.to);
        _transferLeftoverBalance();
        return true;
    }

    /// @notice Swap any token to quote asset, then deposit quote
    /// @param _amount amount of token to swap from
    /// @param _minAmountOut minimum amount of token to receive
    /// @param _tokenFrom token that is to be swapped from
    /// @param _strikeIndex strike index to deposit to
    /// @param _to address to deposit on behalf of
    function swapAndDeposit(
        uint256 _amount,
        uint256 _minAmountOut,
        address _tokenFrom,
        uint256 _strikeIndex,
        address _to
    ) external returns (bool) {
        IERC20 tokenFrom = IERC20(_tokenFrom);

        tokenFrom.safeTransferFrom(msg.sender, address(this), _amount);
        tokenFrom.safeApprove(address(uniswapV2Router), _amount);

        address[] memory path;
        if (_tokenFrom == wrappedNativeToken) {
            path = new address[](2);
            path[0] = wrappedNativeToken;
            path[1] = address(ssovToken);
        } else {
            path = new address[](3);
            path[0] = _tokenFrom;
            path[1] = wrappedNativeToken;
            path[2] = address(ssovToken);
        }

        uint256 ssovTokenAmount = uniswapV2Router.swapExactTokensForTokens(
            _amount,
            _minAmountOut,
            path,
            address(this),
            block.timestamp
        )[path.length - 1];

        ssovToken.safeIncreaseAllowance(address(ssov), ssovTokenAmount);
        ssov.deposit(_strikeIndex, ssovTokenAmount, _to);
        return true;
    }

    /// @notice Swap native token to the quote asset, then deposit quote
    /// @param _fromAmount amount of native token to swap from
    /// @param _minAmountOut minimum amount of tokens to receive
    /// @param _strikeIndex strike index to deposit to
    /// @param _to address to deposit on behalf of
    function swapNativeAndDeposit(
        uint256 _fromAmount,
        uint256 _minAmountOut,
        uint256 _strikeIndex,
        address _to
    ) external payable returns (bool) {
        address[] memory path;
        path[0] = wrappedNativeToken;
        path[1] = address(ssovToken);
        uint256 ssovTokenAmount = uniswapV2Router.swapETHForExactTokens{
            value: _fromAmount
        }(_minAmountOut, path, address(this), block.timestamp)[1];
        ssovToken.safeIncreaseAllowance(address(ssov), ssovTokenAmount);
        ssov.deposit(_strikeIndex, ssovTokenAmount, _to);
        return true;
    }

    /// @notice transfer leftover balance to be used for premium
    function _transferLeftoverBalance() internal returns (bool) {
        if (ssovToken.balanceOf(address(this)) > 0) {
            ssovToken.safeTransfer(
                msg.sender,
                ssovToken.balanceOf(address(this))
            );
        }
        return true;
    }
}
