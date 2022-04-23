import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';

import {
  deployMockOptionPricing,
  deployBnbSSOV,
  deployContract,
  deployMockChainlinkAggregator,
} from '../../helper/contract';
import {
  timeTravel,
  expandTo18Decimals,
  expandToDecimals,
  forkBsc,
} from '../../helper/utils';
import {
  ERC20,
  ERC20__factory,
  BnbSSOV,
  IVBNB,
  IVBNB__factory,
  MockChainlinkAggregator,
  MockOptionPricing,
  BnbSSOVRouter,
} from '../../types';
import { erc20Abi, MAX_VALUE, vbnb } from '../../helper/data';

const vbnbToBnb = async (vbnbContract: IVBNB, vbnbAmount: BigNumber) => {
  return vbnbAmount
    .mul(await vbnbContract.callStatic.exchangeRateCurrent())
    .div(ethers.utils.parseEther('1'));
};

describe('BNB Router Integration tests', async () => {
  let signers: SignerWithAddress[];
  let owner: SignerWithAddress;
  let user0: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let optionPricing: MockOptionPricing;
  let ssov: BnbSSOV;
  let ssovRouter: BnbSSOVRouter;
  let vbnbToken: ERC20;
  let vbnbContract: IVBNB;
  let mockChainlinkAggregator: MockChainlinkAggregator;

  // 1e8
  const strikes = [
    expandToDecimals(5, 8),
    expandToDecimals(100, 8),
    expandToDecimals(8, 8),
  ];
  const strikesEpoch2 = [
    expandToDecimals(100, 8),
    expandToDecimals(150, 8),
    expandToDecimals(5, 8),
  ];

  beforeEach(async () => {
    await forkBsc();
    signers = await ethers.getSigners();
    owner = signers[0];
    user0 = signers[1];
    user1 = signers[2];
    user2 = signers[3];

    vbnbToken = ERC20__factory.connect(vbnb, ethers.provider);
    vbnbContract = IVBNB__factory.connect(vbnb, ethers.provider);

    // Mock wbnb Chainlink Aggregator
    mockChainlinkAggregator = await deployMockChainlinkAggregator();
    await mockChainlinkAggregator.updatePrice('45383000000');

    // Mock Option Pricing
    optionPricing = await deployMockOptionPricing();

    const MockVolatilityOracle = await ethers.getContractFactory(
      'MockVolatilityOracle'
    );

    const mockVolatilityOracle = await MockVolatilityOracle.deploy();

    await vbnbContract.connect(user0).mint({ value: expandTo18Decimals(1000) });
    await vbnbContract.connect(user1).mint({ value: expandTo18Decimals(1000) });
    await vbnbContract.connect(user2).mint({ value: expandTo18Decimals(1000) });

    const feeStrategy = await (
      await ethers.getContractFactory('FeeStrategy')
    ).deploy();

    // SSOV
    ssov = await deployBnbSSOV(
      vbnb,
      optionPricing.address,
      mockChainlinkAggregator.address,
      mockVolatilityOracle.address,
      '0x8A98954DBD6Ca2F446e78F29eC9497D0a4601074',
      feeStrategy.address
    );

    ssovRouter = await deployContract<BnbSSOVRouter>('BnbSSOVRouter', [
      ssov.address,
      vbnb,
    ]);

    await ssov.addToContractWhitelist(ssovRouter.address);
  });

  it('Tests from epoch 1 through 3', async () => {
    const epoch1 = (await ssov.currentEpoch()).add(1); // Epoch 1

    await expect(
      ssov.connect(user0).setStrikes([...strikes])
    ).to.be.revertedWith('Ownable: caller is not the owner');

    await expect(
      ssov.connect(user1).setStrikes([...strikes])
    ).to.be.revertedWith('Ownable: caller is not the owner');

    await ssov.connect(owner).setStrikes([...strikes]);

    // 1. SSOV contract owner sets 3 strike prices for the first epoch. All 3 strikes are ITM

    expect(await ssov.epochStrikes(1, 0)).to.be.equal(strikes[0]);
    expect(await ssov.epochStrikes(1, 1)).to.be.equal(strikes[1]);
    expect(await ssov.epochStrikes(1, 2)).to.be.equal(strikes[2]);

    // 2. Users 0, 1, 2 deposit 1000, 300, 100  for the coming epoch to strike indices 0, 1 & 2 respectively

    // Approve
    await vbnbToken.connect(user0).approve(ssov.address, MAX_VALUE);
    await vbnbToken.connect(user1).approve(ssov.address, MAX_VALUE);
    await vbnbToken.connect(user2).approve(ssov.address, MAX_VALUE);

    await expect(
      ssovRouter.connect(user0).deposit(0, user0.address, {
        value: await vbnbToBnb(vbnbContract, expandToDecimals(1000, 8)),
      })
    ).to.emit(ssov, 'NewDeposit');
    await expect(
      ssovRouter.connect(user1).deposit(1, user1.address, {
        value: await vbnbToBnb(vbnbContract, expandToDecimals(300, 8)),
      })
    ).to.emit(ssov, 'NewDeposit');
    await expect(
      ssovRouter.connect(user2).deposit(2, user2.address, {
        value: await vbnbToBnb(vbnbContract, expandToDecimals(100, 8)),
      })
    ).to.emit(ssov, 'NewDeposit');

    expect(
      (await ssov.totalEpochDeposits(epoch1)).toString().substring(0, 5)
    ).to.be.equal(expandToDecimals(1400, 8).sub(1).toString().substring(0, 5));

    const strike1 = await ssov.epochStrikes(epoch1, 0);
    const user0Strike = ethers.utils.solidityKeccak256(
      ['address', 'uint256'],
      [user0.address, strike1]
    );

    const strike2 = await ssov.epochStrikes(epoch1, 1);
    const user1Strike = ethers.utils.solidityKeccak256(
      ['address', 'uint256'],
      [user1.address, strike2]
    );
    const strike3 = await ssov.epochStrikes(epoch1, 2);
    const user2Strike = ethers.utils.solidityKeccak256(
      ['address', 'uint256'],
      [user2.address, strike3]
    );

    expect(
      (await ssov.userEpochDeposits(epoch1, user0Strike))
        .toString()
        .substring(0, 5)
    ).to.be.equal(expandToDecimals(1000, 8).sub(1).toString().substring(0, 5));
    expect(
      (await ssov.userEpochDeposits(epoch1, user1Strike))
        .toString()
        .substring(0, 5)
    ).to.be.equal(expandToDecimals(300, 8).sub(1).toString().substring(0, 5));
    expect(
      (await ssov.userEpochDeposits(epoch1, user2Strike))
        .toString()
        .substring(0, 5)
    ).to.be.equal(expandToDecimals(100, 8).sub(1).toString().substring(0, 5));

    // 3. Owner bootstraps the SSOV. Current epoch updated from 0 to 1

    await expect(ssov.connect(user0).bootstrap()).to.be.revertedWith(
      'Ownable: caller is not the owner'
    );

    await ssov.bootstrap();

    // 4. User 1 attempts to withdraw for ongoing epoch

    await expect(ssov.connect(user1).withdraw(epoch1, 0)).to.be.revertedWith(
      'E17'
    );

    /*
        5. Users 0, 1, 2 purchase  calls at strikeIndices 0, 1, 2
           Check premium and fee calculations for each user
      */

    const purchaseAmountEpoch1 = expandToDecimals(1, 18);
    const strike = await ssov.epochStrikes(epoch1, 0);
    const usdPrice = await ssov.getUsdPrice();
    const premium = await ssov.calculatePremium(strike1, purchaseAmountEpoch1);

    const premium2 = await ssov.calculatePremium(strike2, purchaseAmountEpoch1);

    const premium3 = await ssov.calculatePremium(strike3, purchaseAmountEpoch1);

    const fees = await ssov.calculatePurchaseFees(
      usdPrice,
      strike1,
      purchaseAmountEpoch1
    );
    const fees2 = await ssov.calculatePurchaseFees(
      usdPrice,
      strike2,
      purchaseAmountEpoch1
    );
    const fees3 = await ssov.calculatePurchaseFees(
      usdPrice,
      strike3,
      purchaseAmountEpoch1
    );

    const totalFees = fees.add(fees2).add(fees3);

    const totalPremium = premium.add(premium2).add(premium3).add(totalFees);

    // Epoch Strike Token
    const epochStrikeTokenAddress = await ssov.epochStrikeTokens(
      epoch1,
      strike
    );
    const epochStrike2TokenAddress = await ssov.epochStrikeTokens(
      epoch1,
      strike2
    );
    const epochStrike3TokenAddress = await ssov.epochStrikeTokens(
      epoch1,
      strike3
    );
    const epochStrikeToken = await ethers.getContractAt(
      erc20Abi,
      epochStrikeTokenAddress
    );
    const epochStrike2Token = await ethers.getContractAt(
      erc20Abi,
      epochStrike2TokenAddress
    );
    const epochStrike3Token = await ethers.getContractAt(
      erc20Abi,
      epochStrike3TokenAddress
    );

    // Past Data
    const pastEpochStrikeTokenBalanceOfVault = await epochStrikeToken.balanceOf(
      ssov.address
    );

    const pastEpochStrikeTokenBalanceOfUser = await epochStrikeToken.balanceOf(
      user0.address
    );

    const pastTotalEpochCallsPurchased = await ssov.totalEpochCallsPurchased(
      epoch1.sub(1),
      strike
    );
    const pastUserEpochCallsPurchased = await ssov.userEpochCallsPurchased(
      epoch1.sub(1),
      user0Strike
    );
    const pastTotalEpochPremium = await ssov.totalEpochPremium(
      epoch1.sub(1),
      strike
    );
    const pastUserEpochPremium = await ssov.userEpochPremium(
      epoch1.sub(1),
      user0Strike
    );
    const pastTotalEpochPremiumMinusFee = pastTotalEpochPremium
      .add(totalPremium)
      .sub(totalFees);

    await expect(
      ssov.connect(user0).purchase(0, purchaseAmountEpoch1, user0.address)
    ).to.emit(ssov, 'NewPurchase');

    expect(
      pastTotalEpochPremiumMinusFee.toString().substring(0, 3)
    ).to.be.equal('153');

    await expect(
      ssov.connect(user1).purchase(2, purchaseAmountEpoch1, user1.address)
    ).to.emit(ssov, 'NewPurchase');

    await expect(
      ssov.connect(user2).purchase(1, purchaseAmountEpoch1, user2.address)
    ).to.emit(ssov, 'NewPurchase');

    expect(await epochStrikeToken.balanceOf(user0.address)).to.be.equal(
      purchaseAmountEpoch1
    );

    expect(await epochStrike2Token.balanceOf(user2.address)).to.be.equal(
      purchaseAmountEpoch1
    );

    expect(await epochStrike3Token.balanceOf(user1.address)).to.be.equal(
      purchaseAmountEpoch1
    );

    // Current Data
    const currentEpochStrikeTokenBalanceOfVault =
      await epochStrikeToken.balanceOf(ssov.address);

    expect(currentEpochStrikeTokenBalanceOfVault).to.be.equal(
      pastEpochStrikeTokenBalanceOfVault.sub(purchaseAmountEpoch1)
    );

    const currentEpochStrikeTokenBalanceOfUser =
      await epochStrikeToken.balanceOf(user0.address);

    expect(currentEpochStrikeTokenBalanceOfUser).to.be.equal(
      pastEpochStrikeTokenBalanceOfUser.add(purchaseAmountEpoch1)
    );

    const currentTotalEpochCallsPurchased = await ssov.totalEpochCallsPurchased(
      epoch1,
      strike1
    );

    expect(currentTotalEpochCallsPurchased).to.be.equal(
      pastTotalEpochCallsPurchased.add(purchaseAmountEpoch1)
    );

    const currentUserEpochCallsPurchased = await ssov.userEpochCallsPurchased(
      epoch1,
      user0Strike
    );

    expect(currentUserEpochCallsPurchased).to.be.equal(
      pastUserEpochCallsPurchased.add(purchaseAmountEpoch1)
    );

    let currentTotalEpochPremium = await ssov.totalEpochPremium(epoch1, strike);

    const currentTotalEpochPremium2 = await ssov.totalEpochPremium(
      epoch1,
      strike2
    );
    const currentTotalEpochPremium3 = await ssov.totalEpochPremium(
      epoch1,
      strike3
    );

    currentTotalEpochPremium = currentTotalEpochPremium
      .add(currentTotalEpochPremium2)
      .add(currentTotalEpochPremium3);

    // totalPremiumForEpoch minus totalFee
    expect(currentTotalEpochPremium.toString().substring(0, 3)).to.be.equal(
      '153'
    );

    const currentUser0EpochPremium = await ssov.userEpochPremium(
      epoch1,
      user0Strike
    );

    // User 0 premium
    expect(currentUser0EpochPremium).to.be.equal(
      pastUserEpochPremium.add(premium)
    );

    // 6. Fast forward to epoch 1 expiry
    await timeTravel(
      (await ssov.getEpochTimes(await ssov.currentEpoch())).end.toNumber() +
        60 -
        (await (
          await ethers.provider.getBlock('latest')
        ).timestamp)
    );

    await ssov['expireEpoch()']();

    // 7. User 0 and User 1 settle. User 2 does not settle
    //    Check pnl calculations of user0, user1, user2
    await epochStrikeToken.connect(user0).approve(ssov.address, MAX_VALUE);
    await epochStrike3Token.connect(user1).approve(ssov.address, MAX_VALUE);

    const user0BalanceBeforeSettlement = await vbnbToken.balanceOf(
      user0.address
    );

    await ssov.connect(user0).settle(0, purchaseAmountEpoch1, epoch1);

    const user0BalanceAfterSettlement = await vbnbToken.balanceOf(
      user0.address
    );

    // pnl for user0
    expect(
      user0BalanceAfterSettlement
        .sub(user0BalanceBeforeSettlement)
        .toString()
        .substring(0, 3)
    ).to.be.equal('459');

    await ssov.connect(user1).settle(2, purchaseAmountEpoch1, epoch1);

    await timeTravel(60 * 60);

    // 9. Check deposited  balances of user0, user1, user2 after epoch expiry

    expect(
      (await ssov.totalEpochDeposits(epoch1)).toString().substring(0, 5)
    ).to.be.equal(expandToDecimals(1400, 8).sub(1).toString().substring(0, 5));

    const user0BalanceBeforeWithdraw = await vbnbToken.balanceOf(user0.address);
    const user2BalanceBeforeWithdraw = await vbnbToken.balanceOf(user2.address);

    // 10. User0 & user2 withdraw before the start of the next epoch. user1 does not withdraw from epoch 1

    await ssov.connect(user0).withdraw(epoch1, 0);
    await ssov.connect(user2).withdraw(epoch1, 2);

    const user0BalanceAfterWithdraw = await vbnbToken.balanceOf(user0.address);

    const user2BalanceAfterWithdraw = await vbnbToken.balanceOf(user2.address);

    expect(
      user0BalanceAfterWithdraw
        .sub(user0BalanceBeforeWithdraw)
        .toString()
        .substring(0, 4)
    ).to.be.equal('9545');
    expect(
      user2BalanceAfterWithdraw
        .sub(user2BalanceBeforeWithdraw)
        .toString()
        .substring(0, 4)
    ).to.be.equal('5485');

    // -------------------------------- EPOCH 2 --------------------------------

    /* ========== EPOCH 2 =========== */

    /* ==== EPOCH 2 TESTS ==== */

    // time travelling after expiry of epoch 1
    // time travelling one day
    timeTravel(86400);

    const epoch2 = (await ssov.currentEpoch()).add(1);

    await expect(ssov.connect(owner).setStrikes(strikesEpoch2)).to.emit(
      ssov,
      'NewStrike'
    );

    /* === USER0 & USER2 DEPOSIT IN EPOCH 2 === */

    const strike0forEpoch2 = await ssov.epochStrikes(epoch2, 2);
    const strike2forEpoch2 = await ssov.epochStrikes(epoch2, 0);

    const user2StrikeEpoch2 = ethers.utils.solidityKeccak256(
      ['address', 'uint256'],
      [user0.address, strike0forEpoch2]
    );
    const user0StrikeEpoch2 = ethers.utils.solidityKeccak256(
      ['address', 'uint256'],
      [user2.address, strike2forEpoch2]
    );

    const depositAmount = expandToDecimals(300, 8);

    // past  balances of user0 and user2
    const pastBalanceUser0 = await vbnbToken.balanceOf(user0.address);
    const pastBalanceUser2 = await vbnbToken.balanceOf(user2.address);

    const pastTotalEpochStrike0Deposits = await ssov.totalEpochStrikeDeposits(
      epoch2,
      strike0forEpoch2
    );

    const pastTotalEpochStrike2Deposits = await ssov.totalEpochStrikeDeposits(
      epoch2,
      strike2forEpoch2
    );

    const pastUser0EpochDeposits = await ssov.userEpochDeposits(
      epoch2,
      user0StrikeEpoch2
    );

    const pastUser2EpochDeposits = await ssov.userEpochDeposits(
      epoch2,
      user2StrikeEpoch2
    );

    const pastTotalEpochDeposits = await ssov.totalEpochDeposits(epoch2);

    /* === USERS DEPOSIT EXCEPT USER 1 === */
    // user0 deposit

    // REF-EPOCH2-DEPOSITS
    await expect(
      ssov.connect(user0).deposit(2, depositAmount, user0.address)
    ).to.emit(ssov, 'NewDeposit');

    // time travelling 1 day
    timeTravel(86400);

    // user2 deposit
    await expect(
      ssov.connect(user2).deposit(0, depositAmount, user2.address)
    ).to.emit(ssov, 'NewDeposit');

    // current balances of users
    const currentBalanceUser0 = await vbnbToken.balanceOf(user0.address);
    const currentBalanceUser2 = await vbnbToken.balanceOf(user2.address);

    const currentTotalEpochStrike0Deposits =
      await ssov.totalEpochStrikeDeposits(epoch2, strike0forEpoch2);

    const currentTotalEpochStrike2Deposits =
      await ssov.totalEpochStrikeDeposits(epoch2, strike2forEpoch2);

    const currentUser0EpochDeposits = await ssov.userEpochDeposits(
      epoch2,
      user2StrikeEpoch2
    );

    const currentUser2EpochDeposits = await ssov.userEpochDeposits(
      epoch2,
      user0StrikeEpoch2
    );

    const currentTotalEpochDeposits = await ssov.totalEpochDeposits(epoch2);

    // assert balance deduction after deposit

    // current balance = past balance - deposited amount
    expect(currentBalanceUser0.toString().substring(0, 6)).to.be.equal(
      pastBalanceUser0.sub(depositAmount).toString().substring(0, 6)
    );

    expect(currentBalanceUser2.toString().substring(0, 6)).to.be.equal(
      pastBalanceUser2.sub(depositAmount).toString().substring(0, 6)
    );

    // DEPOSITS
    // current epoch deposits = previous deposits + deposited amount
    expect(currentUser0EpochDeposits).to.equal(
      pastUser0EpochDeposits.add(depositAmount)
    );

    expect(currentUser2EpochDeposits.toString()).to.equal(
      pastUser2EpochDeposits.add(depositAmount)
    );

    // for strike index 0 in epoch 2
    expect(currentTotalEpochStrike0Deposits).to.equal(
      pastTotalEpochStrike0Deposits.add(depositAmount)
    );

    // for strike index 2 in epoch 2
    expect(currentTotalEpochStrike2Deposits).to.equal(
      pastTotalEpochStrike2Deposits.add(depositAmount)
    );

    // user0s deposit + user2 deposits
    expect(currentTotalEpochDeposits.toString()).to.equal(
      pastTotalEpochDeposits.add(depositAmount.mul(2))
    );
  });
});
