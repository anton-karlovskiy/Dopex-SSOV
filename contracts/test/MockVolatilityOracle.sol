// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import {IVolatilityOracle} from '../interfaces/IVolatilityOracle.sol';

contract MockVolatilityOracle {
    /**
     * @notice Gets the iv of dpx
     * @return iv
     */
    function getVolatility() public pure returns (uint256) {
        return 100;
    }

    function getVolatility(uint256) public pure returns (uint256) {
        return 100;
    }
}
