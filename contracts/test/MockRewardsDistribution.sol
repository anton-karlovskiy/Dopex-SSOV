// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

contract MockRewardsDistribution {
    function pull(
        uint256,
        uint256,
        uint256,
        address
    ) external pure returns (uint256, uint256) {
        return (0, 0);
    }
}
