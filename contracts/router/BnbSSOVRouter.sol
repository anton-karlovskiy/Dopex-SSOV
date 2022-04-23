// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

// Libraries
import {SafeERC20} from '../external/libraries/SafeERC20.sol';

// Interfaces
import {IERC20} from '../external/interfaces/IERC20.sol';
import {IVBNB} from '../external/interfaces/IVBNB.sol';
import {IERC20SSOV} from '../interfaces/IERC20SSOV.sol';

contract BnbSSOVRouter {
    using SafeERC20 for IERC20;

    IERC20SSOV public immutable ssov;
    address public immutable vbnb;

    /// @notice Constructor
    /// @param _ssov address of SSOV
    /// @param _vbnb VBNB address
    constructor(address _ssov, address _vbnb) {
        ssov = IERC20SSOV(_ssov);
        vbnb = _vbnb;
    }

    receive() external payable {}

    /// @notice Purchases calls for the current epoch
    /// @param _strikeIndex Strike index for current epoch
    /// @param _amount Amount of calls to purchase
    /// @param _to User to purchase options for
    /// @return Whether purchase was successful
    function purchase(
        uint256 _strikeIndex,
        uint256 _amount,
        address _to
    ) external payable returns (uint256, uint256) {
        IVBNB(vbnb).mint{value: msg.value}();
        uint256 vbnbAmount = IERC20(vbnb).balanceOf(address(this));
        IERC20(address(vbnb)).safeIncreaseAllowance(address(ssov), vbnbAmount);
        (uint256 premium, uint256 totalFee) = ssov.purchase(
            _strikeIndex,
            _amount,
            _to
        );
        _transferLeftoverBalance();
        return (premium, totalFee);
    }

    /// @notice Deposits BNB into the ssov to mint options in the next epoch for selected strikes
    /// @param _strikeIndex Index of strike
    /// @param _to Address of the user to deposit for
    /// @return Whether deposit was successful
    function deposit(uint256 _strikeIndex, address _to)
        external
        payable
        returns (bool)
    {
        IVBNB(vbnb).mint{value: msg.value}();
        uint256 vbnbAmount = IERC20(vbnb).balanceOf(address(this));
        IERC20(address(vbnb)).safeIncreaseAllowance(address(ssov), vbnbAmount);
        bool success = ssov.deposit(_strikeIndex, vbnbAmount, _to);
        _transferLeftoverBalance();
        return success;
    }

    /// @notice Deposit BNB multiple times into different strike
    /// @param _strikeIndices Indices of strikes to deposit into
    /// @param _amounts Amount of BNB to deposit into each strike index
    /// @param _to Address of the user to deposit for
    /// @return Whether deposits went through successfully
    function depositMultiple(
        uint256[] calldata _strikeIndices,
        uint256[] calldata _amounts,
        address _to
    ) external payable returns (bool) {
        uint256 totalAmount;
        for (uint256 i = 0; i < _amounts.length; i++) {
            totalAmount += _amounts[i];
        }
        require(msg.value >= totalAmount, 'Invalid amount');
        IVBNB(vbnb).mint{value: msg.value}();
        uint256 vbnbAmount = IERC20(vbnb).balanceOf(address(this));
        uint256[] memory vbnbAmounts = new uint256[](_amounts.length);
        for (uint256 i = 0; i < _amounts.length; i++) {
            vbnbAmounts[i] = (vbnbAmount * _amounts[i]) / totalAmount;
        }
        IERC20(address(vbnb)).safeIncreaseAllowance(address(ssov), vbnbAmount);
        bool success = ssov.depositMultiple(_strikeIndices, vbnbAmounts, _to);
        _transferLeftoverBalance();
        return success;
    }

    /// @notice transfer leftover balance to be used for premium
    function _transferLeftoverBalance() internal {
        uint256 vbnbBalance = IERC20(vbnb).balanceOf(address(this));
        if (vbnbBalance > 0) {
            require(IVBNB(vbnb).redeem(vbnbBalance) == 0, 'Redeem failed');
            uint256 bnbBalance = address(this).balance;
            if (bnbBalance > 0) {
                (bool success, ) = msg.sender.call{value: bnbBalance}('');
                require(success, 'Unable to send BNB');
            }
        }
    }
}
