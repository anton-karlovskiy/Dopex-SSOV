// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

contract Yearn {
    mapping(address => uint256) public balances;

    function deposit(uint256 amount) external {
        balances[msg.sender] += amount;
    }

    function withdraw() external returns (uint256) {
        uint256 balance = balances[msg.sender];
        balances[msg.sender] = 0;
        return balance;
    }

    function balanceOf(address user) external view returns (uint256) {
        return balances[user];
    }
}
