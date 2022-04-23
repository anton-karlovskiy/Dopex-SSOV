//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

/**                                                                                                 
          █████╗ ████████╗██╗      █████╗ ███╗   ██╗████████╗██╗ ██████╗
          ██╔══██╗╚══██╔══╝██║     ██╔══██╗████╗  ██║╚══██╔══╝██║██╔════╝
          ███████║   ██║   ██║     ███████║██╔██╗ ██║   ██║   ██║██║     
          ██╔══██║   ██║   ██║     ██╔══██║██║╚██╗██║   ██║   ██║██║     
          ██║  ██║   ██║   ███████╗██║  ██║██║ ╚████║   ██║   ██║╚██████╗
          ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝ ╚═════╝
                                                                        
          ██████╗ ██████╗ ████████╗██╗ ██████╗ ███╗   ██╗███████╗       
          ██╔═══██╗██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║██╔════╝       
          ██║   ██║██████╔╝   ██║   ██║██║   ██║██╔██╗ ██║███████╗       
          ██║   ██║██╔═══╝    ██║   ██║██║   ██║██║╚██╗██║╚════██║       
          ╚██████╔╝██║        ██║   ██║╚██████╔╝██║ ╚████║███████║       
          ╚═════╝ ╚═╝        ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝       
                                                               
                            Atlantic Options
              Yield bearing put options with mobile collateral                                                           
*/

interface IAtlantic {

  // Deposits collateral as a writer with a specified max strike for the next epoch
  function deposit(
    uint maxStrike,
    address user
  ) external payable returns (bool);

  // Purchases an atlantic for a specified strike
  function purchase(
    uint strike,
    uint amount,
    address user
  ) external returns (bool);

  // Returns address of strike tokens for an epoch
  function epochStrikeTokens(
    uint256 epoch,
    uint256 strike
  ) external view returns (address);

  function getAddress(bytes32 name) external view returns (address);

  function currentEpoch() external view returns (uint256);

  // Unlocks collateral from an atlantic by depositing underlying. Callable by dopex managed contract integrations.
  function unlockCollateral(
    uint strike,
    uint amount
  ) external returns (bool);

  // Gracefully exercises an atlantic, sends collateral to integrated protocol, 
  // underlying to writer and charges an unwind fee as well as remaining funding fees
  // to the option holder/protocol
  function unwind(
    uint strike,
    uint amount,
    address user
  ) external returns (bool);

  // Re-locks collateral into an atlatic option. Withdraws underlying back to user, sends collateral back
  // from dopex managed contract to option, deducts remainder of funding fees. 
  // Handles exceptions where collateral may get stuck due to failures in other protocols.
  function relockCollateral(
    uint strike,
    uint amount
  ) external returns (bool);

  // Collects funding for an active atlantic option with unlocked collateral and sends it to the writers pool
  function collectFunding(
    uint strike,
    uint amount,
    address user
  ) external returns (bool);

}