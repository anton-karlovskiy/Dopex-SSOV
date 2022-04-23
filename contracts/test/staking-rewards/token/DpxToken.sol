// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC20PresetMinterPauser} from '@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol';

contract DpxToken is ERC20PresetMinterPauser('Dopex.io Token', 'DPX') {
  constructor() {
    _mint(address(this), 500000 ether);
  }
}