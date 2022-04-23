// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import {IOptionPricing} from '../interfaces/IOptionPricing.sol';

contract MockOptionPricing is IOptionPricing {
    function getOptionPrice(
        bool,
        uint256,
        uint256,
        uint256,
        uint256
    ) external pure override returns (uint256) {
        return 5e8; // 5$
    }
}
