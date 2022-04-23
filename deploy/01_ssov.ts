import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ethers } from 'hardhat';
import web3Utils from 'web3-utils';

const utf8ToHex = (str: string) =>
  web3Utils.rightPad(ethers.utils.hexlify(ethers.utils.toUtf8Bytes(str)), 64);

const deploy = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;

  const { deployer } = await getNamedAccounts();

  const priceOracle = await deployments.deploy('GmxCustomPriceOracle', {
    from: deployer,
    args: [],
    log: true,
  });

  const volOracle = await deployments.deploy('GmxVolatilityOracle', {
    from: deployer,
    args: [],
    log: true,
  });

  await deployments.deploy('GmxSSOV', {
    from: deployer,
    args: [
      [
        utf8ToHex('GMX'),
        utf8ToHex('esGMX'),
        utf8ToHex('WETH'),
        utf8ToHex('RewardRouterV2'),
        utf8ToHex('StakedGmxTracker'),
        utf8ToHex('BonusGmxTracker'),
        utf8ToHex('FeeGmxTracker'),
        utf8ToHex('OptionPricing'),
        utf8ToHex('GmxPriceOracle'),
        utf8ToHex('VolatilityOracle'),
        utf8ToHex('FeeDistributor'),
        utf8ToHex('FeeStrategy'),
      ],
      [
        '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', // GMX Address
        '0xf42Ae1D54fd613C9bb14810b0588FaAa09a426cA',
        '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
        '0xA906F338CB21815cBc4Bc87ace9e68c87eF8d8F1',
        '0x908c4d94d34924765f1edc22a1dd098397c59dd4',
        '0x4d268a7d4c16ceb5a606c173bd974984343fea13',
        '0xd2d1162512f927a7e282ef43a362659e4f2a728f',
        '0x2b99e3D67dAD973c1B9747Da742B7E26c8Bdd67B',
        priceOracle.address,
        volOracle.address,
        '0x55594cCe8cC0014eA08C49fd820D731308f204c1',
        '0x3F3c58CCb0655Fa9161D0B4B49B217b3f6478D5A',
      ],
    ],
    log: true,
  });

  // await deployments.deploy('ArbEthSSOVV2', {
  //   from: deployer,
  //   args: [
  //     '0x09A454fD7A7f6F66CB2cC0196860F94CEd5b952B',
  //     '0x2b99e3d67dad973c1b9747da742b7e26c8bdd67b',
  //     '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
  //     '0x87209686d0f085fD35B084410B99241Dbc03fb4f',
  //     '0x55594cCe8cC0014eA08C49fd820D731308f204c1',
  //     feeStrategy.address,
  //   ],
  //   log: true,
  // });

  // await deployments.deploy('DpxSSOVV2', {
  //   from: deployer,
  //   args: [
  //     '0x6c2c06790b3e3e3c38e12ee22f8183b37a13ee55',
  //     '0x32eb7902d4134bf98a28b963d26de779af92a212',
  //     '0xc6D714170fE766691670f12c2b45C1f34405AAb6',
  //     '0x2b99e3d67dad973c1b9747da742b7e26c8bdd67b',
  //     '0x252C07E0356d3B1a8cE273E39885b094053137b9',
  //     '0xb6645813567bb5beea8f62e793d075fe6d3be0b1',
  //     '0x55594cCe8cC0014eA08C49fd820D731308f204c1',
  //     feeStrategy.address,
  //   ],
  //   log: true,
  // });

  // await deployments.deploy('RdpxSSOVV2', {
  //   from: deployer,
  //   args: [
  //     '0x6c2c06790b3e3e3c38e12ee22f8183b37a13ee55',
  //     '0x32eb7902d4134bf98a28b963d26de779af92a212',
  //     '0x8d481245801907b45823Fb032E6848d0D3c29AE5',
  //     '0x2b99e3d67dad973c1b9747da742b7e26c8bdd67b',
  //     '0xC0cdD1176aA1624b89B7476142b41C04414afaa0',
  //     '0x3E0215c1D639280e13B46e3aF94Fb5630d1b3212',
  //     '0x55594cCe8cC0014eA08C49fd820D731308f204c1',
  //     feeStrategy.address,
  //   ],
  //   log: true,
  // });

  // await deployments.deploy('GohmSSOVV2', {
  //   from: deployer,
  //   args: [
  //     '0x8D9bA570D6cb60C7e3e0F31343Efe75AB8E65FB1',
  //     '0x2b99e3D67dAD973c1B9747Da742B7E26c8Bdd67B',
  //     '0x5f5870C7364AE87643747B06a0Ca7fdE200147d4',
  //     '0xbf91446115f3E3eaF5079A88E078F876C0d7A6A8',
  //     '0x55594cCe8cC0014eA08C49fd820D731308f204c1',
  //     feeStrategy.address,
  //   ],
  //   log: true,
  // });

  // await deployments.deploy('GmxSSOV', {
  //   from: deployer,
  //   args: [
  //     '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', // Gmx Token
  //     '0x908C4D94D34924765f1eDc22A1DD098397c59dD4', // Gmx Staking
  //     // OptionPricing,
  //     // GmxPriceOracle,
  //     // VolatilityOracle,
  //     '0x55594cCe8cC0014eA08C49fd820D731308f204c1', // FeeDistributor
  //     feeStrategy.address,
  //   ],
  //   log: true,
  // });
};

export default deploy;
