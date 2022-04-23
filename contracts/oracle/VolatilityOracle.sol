// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

// Contracts
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';

// Interfaces
import {IVolatilityOracle} from '../interfaces/IVolatilityOracle.sol';

contract VolatilityOracle is Ownable, IVolatilityOracle {
    /*==== PUBLIC VARS ====*/

    uint256 public lastVolatility;

    /*==== SETTER FUNCTIONS (ONLY OWNER) ====*/

    /**
     * @notice Updates the last volatility for DPX
     * @param v volatility
     * @return volatility of dpx
     */
    function updateVolatility(uint256 v) external onlyOwner returns (uint256) {
        require(v != 0, 'VolatilityOracle: Volatility cannot be 0');

        lastVolatility = v;

        return v;
    }

    /*==== VIEWS ====*/

    /**
     * @notice Gets the volatility of dpx
     * @return volatility
     */
    function getVolatility() external view override returns (uint256) {
        require(lastVolatility != 0, 'VolatilityOracle: Last volatility == 0');

        return lastVolatility;
    }
}