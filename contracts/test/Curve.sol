// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

contract Curve {
    mapping(address => uint256) public balances;

    receive() external payable {}

    function add_liquidity(uint256[2] calldata, uint256)
        external
        payable
        returns (uint256)
    {
        balances[msg.sender] = msg.value;
        return msg.value;
    }

    function remove_liquidity_one_coin(
        uint256,
        int128,
        uint256
    ) external returns (uint256) {
        uint256 balance = balances[msg.sender];

        balances[msg.sender] = 0;

        payable(msg.sender).transfer(balance);

        return balance;
    }
}
