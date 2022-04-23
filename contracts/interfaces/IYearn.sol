// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

interface IYearn {
    function deposit() external returns (uint256);

    function deposit(uint256 _tokens) external returns (uint256);

    function deposit(uint256 _tokens, address recipient)
        external
        returns (uint256);

    function withdraw() external returns (uint256);

    function withdraw(uint256 _shares) external returns (uint256);

    function withdraw(uint256 _shares, address recipient)
        external
        returns (uint256);

    function pricePerShare() external view returns (uint256);

    function transfer(address receiver, uint256 amount) external returns (bool);

    function transferFrom(
        address sender,
        address receiver,
        uint256 amount
    ) external returns (bool);

    function approve(address spender, uint256 amount) external returns (bool);

    function permit(
        address owner,
        address spender,
        uint256 amount,
        uint256 expiry,
        bytes memory signature
    ) external returns (bool);

    function name() external view returns (string memory);

    function symbol() external view returns (string memory);

    function decimals() external view returns (uint256);

    function version() external view returns (string memory);

    function balanceOf(address arg0) external view returns (uint256);

    function allowance(address arg0, address arg1)
        external
        view
        returns (uint256);

    function totalSupply() external view returns (uint256);

    function nonces(address arg0) external view returns (uint256);

    function DOMAIN_SEPARATOR() external view returns (bytes32);

    function depositLimit() external view returns (uint256);
}
