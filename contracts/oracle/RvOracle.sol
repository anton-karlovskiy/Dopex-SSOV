// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

// Contracts
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';

// Interfaces
import {IVolatilityOracle} from '../interfaces/IVolatilityOracle.sol';

// Libraries
import {RealizedVolatility} from '../libraries/RealizedVolatility.sol';

contract RvOracle is Ownable, IVolatilityOracle {
    uint256 public points;
    uint256 public window;

    DpxOracle public dpxOracle;

    constructor(
        uint256 _points,
        uint256 _window,
        address _dpxOracle
    ) {
        points = _points;
        window = _window;
        dpxOracle = DpxOracle(_dpxOracle);
    }

    /**
     * @notice Updates points and window for rv sampling
     * @param _points The no. of points of pricing data to sample
     * @param _window The window size (x * period of oracle)
     */
    function updateVars(uint256 _points, uint256 _window) external onlyOwner {
        points = _points;
        window = _window;
    }

    /**
     * @notice Updates the dpx oracle
     * @param _dpxOracle The DPX oracle address
     */
    function updateOracle(address _dpxOracle) external onlyOwner {
        dpxOracle = DpxOracle(_dpxOracle);
    }

    /*==== VIEWS ====*/

    /**
     * @notice Gets the volatility of dpx
     * @return volatility
     */
    function getVolatility() external view override returns (uint256) {
        uint256 volatility = RealizedVolatility.calculateRv(
            dpxOracle.sample(1e18, points, window)
        );

        require(volatility != 0, 'VolatilityOracle: volatility cannot be 0');

        return volatility;
    }
}

interface DpxOracle {
    function sample(
        uint256 amountIn,
        uint256 points,
        uint256 window
    ) external view returns (uint256[] memory);
}
