// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';

contract MockChainlinkAggregator is Ownable {
    uint256 public price = 100e8;

    function updatePrice(uint256 _price) external onlyOwner returns (bool) {
        price = _price;
        return true;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        return (0, int256(price), 0, 0, 0);
    }
}
