// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IRewardRouterV2 {
    function stakeGmx(uint256 _amount) external;

    function stakeGmxForAccount(address _account, uint256 _amount) external;

    function stakeEsGmx(uint256 _amount) external;

    function unstakeGmx(uint256 _amount) external;

    function unstakeEsGmx(uint256 _amount) external;

    function claim() external;

    function claimEsGmx() external;

    function claimFees() external;

    function compound() external;

    function signalTransfer(address _receiver) external;

    function acceptTransfer(address _sender) external;

    function handleRewards(
        bool _shouldClaimGmx,
        bool _shouldStakeGmx,
        bool _shouldClaimEsGmx,
        bool _shouldStakeEsGmx,
        bool _shouldStakeMultiplierPoints,
        bool _shouldClaimWeth,
        bool _shouldConvertWethToEth
    ) external;

    function compoundForAccount(address _account) external;
}
