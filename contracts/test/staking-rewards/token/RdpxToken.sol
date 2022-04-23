// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC20PresetMinterPauser} from '@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol';

contract RdpxToken is ERC20PresetMinterPauser('Rebate Dopex Token', 'rDPX') {
  constructor() {
    _mint(address(this), 2000000 ether);
  }
}
