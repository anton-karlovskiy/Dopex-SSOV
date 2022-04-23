import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import web3Utils from 'web3-utils';

import {
  deployPriceOracleAggregator,
  deployMockDPXChainlinkUSDAdapter,
  deployMockOptionPricing,
  deploySSOV,
  deployStakingRewards,
  deployTokens,
} from '../helper/contract';
import {
  timeTravel,
  expandTo18Decimals,
  expandToDecimals,
} from '../helper/utils';
import {
  DpxSSOVV2,
  MockOptionPricing,
  StakingRewards,
  PriceOracleAggregator,
} from '../types';
import { erc20Abi, MAX_VALUE } from '../helper/data';

/* 
    Owner, user1 and user2 accounts are initialized with 10k dpx each.
    
    stakingRewards for dpx rewards initialized by owner spanning a period of 365 days, 
    without a boosted period, for 15k DPX & 500k rDPX rewards.

    Epoch initially at 0 before first bootstrap. 
    
    1. SSOV contract owner sets 3 strike prices for the first epoch. All 3 strikes are ITM
    2. Users 0, 1, 2 deposit 1000, 500, 100 dpx for the coming epoch to strike indices 0, 1 & 2 respectively
    3. Owner bootstraps the SSOV. Current epoch updated from 0 to 1
    4. User 1 attempts to withdraw for ongoing epoch
    5. Users 0, 1, 2 purchase dpx calls at strikeIndices 0, 1, 2
       Check premium and fee calculations for each user
    6. Fast forward to epoch 1 expiry
    7. User 0 & 1 settle after expiry. User 2 does not settle
       Check pnl calculations of user0, user1, user2
    8. STUB
    9. Check deposited dpx balances of user0, user1, user2 after epoch expiry
    10. User0 & user2 withdraw before the start of the next epoch. user1 does not withdraw from epoch 1

    11. Owner sets strikes for next epoch (epoch 2). 2 strikes OTM, 1 strike ITM
    12. User0 & user2 deposit to next epoch to strikeIndices 2 (ITM) and 0 (OTM) respectively
    13. STUB
    14. Owner bootstraps epoch 2
    15. User1 deposits dpx after bootstrap of epoch 2 (to epoch 3) to strikeIndex 2
    16. User2 emergency withdraws from epoch 2.
    17. User0, user1, user2 purchases dpx ITM calls (same strike different amounts) for epoch 2
    18. Fast forward to exercise window
    19. User0, user1, user2 exercise dpx calls
        Check pnl calculations for users
        Check staked balance of user0. It must be less than deposited amount if staked amount + premium + fee < exercise pnl
    20. Fast forward to expiry & expire epoch 2
    21. Check deposited dpx balances (User0 balance before epoch 2 start and after end)
    22. User0 withdraws dpx
    23. User0, user2 deposit to epoch 3 for multiple strikes; strikeIndex 0, 1 & 2 and 1 & 2. StrikeIndex 0 is ITM, 1 & 2 OTM
    24. User1 purchases for all 3 strikes
*/

const utf8ToHex = (str: string) =>
  web3Utils.rightPad(ethers.utils.hexlify(ethers.utils.toUtf8Bytes(str)), 64);

describe('DPX SSOV Integration tests', async () => {
  let signers: SignerWithAddress[];
  let owner: SignerWithAddress;
  let user0: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let dpxToken: Contract;
  let rdpxToken: Contract;
  let stakingRewardsContract: StakingRewards;
  let optionPricing: MockOptionPricing;
  let ssov: DpxSSOVV2;
  let priceOracleAggregator: PriceOracleAggregator;

  const strikes = [
    expandToDecimals(50, 8),
    expandToDecimals(10, 8),
    expandToDecimals(80, 8),
  ];
  const strikesEpoch2 = [
    expandToDecimals(1000, 8),
    expandToDecimals(1500, 8),
    expandToDecimals(50, 8),
  ];
  const strikesEpoch3 = [
    expandToDecimals(70, 8),
    expandToDecimals(1500, 8),
    expandToDecimals(2000, 8),
  ];

  beforeEach(async () => {
    signers = await ethers.getSigners();
    owner = signers[0];

    // Users
    user0 = signers[1];
    user1 = signers[2];
    user2 = signers[3];

    const tokens = await deployTokens();
    // DpxToken
    dpxToken = tokens.dpxToken;

    // RdpxToken
    rdpxToken = tokens.rdpxToken;

    await dpxToken.mint(user0.address, expandTo18Decimals(10000));
    await dpxToken.mint(user1.address, expandTo18Decimals(10000));
    await dpxToken.mint(user2.address, expandTo18Decimals(10000));

    // StakingRewardsContract
    const { stakingRewards, stakingRewardsFactory } =
      await deployStakingRewards(
        (await ethers.provider.getBlock('latest')).timestamp + 10,
        dpxToken.address,
        rdpxToken.address,
        owner
      );

    stakingRewardsContract = stakingRewards;

    // Chainlink Price Aggregator
    priceOracleAggregator = await deployPriceOracleAggregator();

    // Mock DPX Chainlink USD Adapter
    const mockERC20ChainlinkUSDAdapter =
      await deployMockDPXChainlinkUSDAdapter();
    await priceOracleAggregator.updateOracleForAsset(
      dpxToken.address,
      mockERC20ChainlinkUSDAdapter.address
    );
    await priceOracleAggregator.getPriceInUSD(dpxToken.address);

    // Mock Option Pricing
    optionPricing = await deployMockOptionPricing();

    const MockVolatilityOracle = await ethers.getContractFactory(
      'MockVolatilityOracle'
    );

    const mockVolatilityOracle = await MockVolatilityOracle.deploy();

    const feeStrategy = await (
      await ethers.getContractFactory('FeeStrategy')
    ).deploy();

    // SSOV
    ssov = await deploySSOV(
      dpxToken.address,
      rdpxToken.address,
      stakingRewardsContract.address,
      optionPricing.address,
      mockERC20ChainlinkUSDAdapter.address,
      mockVolatilityOracle.address,
      mockVolatilityOracle.address,
      feeStrategy.address
    );

    await stakingRewardsFactory.addToContractWhitelist(ssov.address, 1);

    await dpxToken.mint(
      stakingRewardsFactory.address,
      expandTo18Decimals(15000)
    );
    await rdpxToken.mint(
      stakingRewardsFactory.address,
      expandTo18Decimals(500000)
    );

    await stakingRewardsFactory.notifyRewardAmounts();
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

    // 2. Users 0, 1, 2 deposit 1000 dpx for the coming epoch to strike indices 0, 1 & 2 respectively

    // Approve
    await dpxToken.connect(user0).approve(ssov.address, MAX_VALUE);
    await dpxToken.connect(user1).approve(ssov.address, MAX_VALUE);
    await dpxToken.connect(user2).approve(ssov.address, MAX_VALUE);

    await expect(
      ssov.connect(user0).deposit(0, expandTo18Decimals(1000), user0.address)
    ).to.emit(ssov, 'NewDeposit');
    await expect(
      ssov.connect(user1).deposit(1, expandTo18Decimals(500), user1.address)
    ).to.emit(ssov, 'NewDeposit');
    await expect(
      ssov.connect(user2).deposit(2, expandTo18Decimals(100), user2.address)
    ).to.emit(ssov, 'NewDeposit');

    expect(await ssov.totalEpochDeposits(epoch1)).to.be.equal(
      expandTo18Decimals(1600)
    );

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

    expect(await ssov.userEpochDeposits(epoch1, user0Strike)).to.be.equal(
      expandTo18Decimals(1000)
    );
    expect(await ssov.userEpochDeposits(epoch1, user1Strike)).to.be.equal(
      expandTo18Decimals(500)
    );
    expect(await ssov.userEpochDeposits(epoch1, user2Strike)).to.be.equal(
      expandTo18Decimals(100)
    );

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
      5. Users 0, 1, 2 purchase dpx calls at strikeIndices 0, 1, 2
         Check premium and fee calculations for each user
    */

    const purchaseAmountEpoch1 = expandTo18Decimals(10);
    const block = await ethers.provider.getBlock(
      await ethers.provider.getBlockNumber()
    );
    const strike = await ssov.epochStrikes(epoch1, 0);
    const expiry = await ssov.getMonthlyExpiryFromTimestamp(block.timestamp);
    const usdPrice = await priceOracleAggregator.viewPriceInUSD(
      dpxToken.address
    );
    const premium = purchaseAmountEpoch1
      .mul(
        await optionPricing.getOptionPrice(
          false,
          expiry,
          strike1,
          usdPrice,
          100
        )
      )
      .div(usdPrice);

    const premium2 = purchaseAmountEpoch1
      .mul(
        await optionPricing.getOptionPrice(
          false,
          expiry,
          strike2,
          usdPrice,
          100
        )
      )
      .div(usdPrice);

    const premium3 = purchaseAmountEpoch1
      .mul(
        await optionPricing.getOptionPrice(
          false,
          expiry,
          strike3,
          usdPrice,
          100
        )
      )
      .div(usdPrice);

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

    const pastDpxTokenBalanceOfUser = await dpxToken.balanceOf(user0.address);
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

    expect(pastTotalEpochPremiumMinusFee).to.be.equal('1500000000000000000'); // 1.5 DPX in total premiums

    await dpxToken.connect(user1).approve(ssov.address, MAX_VALUE);
    await dpxToken.connect(user2).approve(ssov.address, MAX_VALUE);

    // User 1 purchase
    await expect(
      ssov.connect(user1).purchase(2, purchaseAmountEpoch1, user1.address)
    ).to.emit(ssov, 'NewPurchase');

    // User 2 purchase
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

    // Fee Distributor balance after purchase by user0
    const feeDistributorBalance = await dpxToken.balanceOf(
      await ssov.getAddress(utf8ToHex('FeeDistributor'))
    );

    // Check if fee distributor has received fees
    expect(feeDistributorBalance).to.be.equal(totalFees);

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

    const currentDpxTokenBalanceOfUser0 = await dpxToken.balanceOf(
      user0.address
    );

    expect(currentDpxTokenBalanceOfUser0).to.be.equal(
      pastDpxTokenBalanceOfUser.sub(premium).sub(fees)
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

    // totalPremiumForEpoch
    expect(currentTotalEpochPremium).to.be.equal('1500000000000000000');

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

    const dpxRewardsEarnedEpoch1 = (
      await stakingRewardsContract.earned(ssov.address)
    ).DPXtokensEarned;

    await ssov['expireEpoch()']();

    // 7. User 0 and User 1 settle after epoch expiry. User 2 does not settle
    //    Check pnl calculations of user0, user1, user2
    await epochStrikeToken.connect(user0).approve(ssov.address, MAX_VALUE);
    await epochStrike3Token.connect(user1).approve(ssov.address, MAX_VALUE);
    await epochStrike2Token.connect(user2).approve(ssov.address, MAX_VALUE);
    const user0BalanceBeforeSettlement = await dpxToken.balanceOf(
      user0.address
    );

    const user1BalanceBeforeSettlement = await dpxToken.balanceOf(
      user1.address
    );

    await ssov.connect(user0).settle(0, purchaseAmountEpoch1, epoch1);
    await ssov.connect(user1).settle(2, purchaseAmountEpoch1, epoch1);

    const user0BalanceAfterSettlement = await dpxToken.balanceOf(user0.address);

    const user1BalanceAfterSettlement = await dpxToken.balanceOf(user1.address);

    // pnl for user0
    expect(
      user0BalanceAfterSettlement.sub(user0BalanceBeforeSettlement)
    ).to.be.equal('5000000000000000000'); // 5dpx

    // pnl for user1

    expect(
      user1BalanceAfterSettlement.sub(user1BalanceBeforeSettlement)
    ).to.be.equal('2000000000000000000'); // 2dpx

    await timeTravel(60 * 60);

    // 8. STUB

    const user0DpxRewards = dpxRewardsEarnedEpoch1.mul(625).div(1000);
    const user2DpxRewards = dpxRewardsEarnedEpoch1.mul(625).div(10000);

    // 9. Check deposited dpx balances of user0, user1, user2 after epoch expiry

    expect(await ssov.totalEpochDeposits(epoch1)).to.be.equal(
      expandTo18Decimals(1600)
    );

    const user0DpxBalanceBeforeWithdraw = await dpxToken.balanceOf(
      user0.address
    );
    const user2DpxBalanceBeforeWithdraw = await dpxToken.balanceOf(
      user2.address
    );

    // 10. User0 & user2 withdraw before the start of the next epoch. user1 does not withdraw from epoch 1

    await ssov.connect(user0).withdraw(epoch1, 0);
    await ssov.connect(user2).withdraw(epoch1, 2);

    const user0DpxBalanceAfterWithdraw = await dpxToken.balanceOf(
      user0.address
    );

    const user2DpxBalanceAfterWithdraw = await dpxToken.balanceOf(
      user2.address
    );

    expect(
      user0DpxBalanceAfterWithdraw
        .sub(user0DpxBalanceBeforeWithdraw)
        .toString()
        .substring(0, 2)
    ).to.be.equal(
      BigNumber.from('995500140000000000000')
        .add(user0DpxRewards)
        .toString()
        .substring(0, 2)
    );

    expect(
      user2DpxBalanceAfterWithdraw
        .sub(user2DpxBalanceBeforeWithdraw)
        .toString()
        .substring(0, 2)
    ).to.be.equal(
      BigNumber.from('98500140000000000000')
        .add(user2DpxRewards)
        .toString()
        .substring(0, 2)
    );

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

    // REF-EPOCH2-STRIKES
    const newSetStrikes0 = await ssov.epochStrikes(epoch2, 0);
    const newSetStrikes1 = await ssov.epochStrikes(epoch2, 1);
    const newSetStrikes2 = await ssov.epochStrikes(epoch2, 2);

    expect(newSetStrikes0.toString()).to.be.equal('100000000000'); // OTM
    expect(newSetStrikes1.toString()).to.be.equal('150000000000'); // OTM
    expect(newSetStrikes2.toString()).to.be.equal('5000000000'); // ITM

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

    const depositAmount = expandTo18Decimals(300);
    const user1DepositAmount = expandTo18Decimals(10);

    // past Dpx balances of user0 and user2
    const pastDpxBalanceUser0 = await dpxToken.balanceOf(user0.address);
    const pastDpxBalanceUser2 = await dpxToken.balanceOf(user2.address);

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

    // approve
    await dpxToken.connect(user0).approve(ssov.address, depositAmount);
    await dpxToken.connect(user2).approve(ssov.address, depositAmount);

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
    const currentDpxBalanceUser0 = await dpxToken.balanceOf(user0.address);
    const currentDpxBalanceUser2 = await dpxToken.balanceOf(user2.address);

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
    expect(currentDpxBalanceUser0).to.be.equal(
      pastDpxBalanceUser0.sub(depositAmount)
    );

    expect(currentDpxBalanceUser2).to.be.equal(
      pastDpxBalanceUser2.sub(depositAmount)
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

    console.log(
      '===========================\nUSER BALANCES BEFORE DEPOSIT\n==========================='
    );
    console.table([
      ['USER0', pastDpxBalanceUser0.toString()],
      ['USER2', pastDpxBalanceUser2.toString()],
    ]);
    console.log(
      '===========================\nUSER BALANCES AFTER DEPOSIT\n==========================='
    );
    console.table([
      [
        'USER0',
        currentDpxBalanceUser0.toString(),
        pastDpxBalanceUser0.sub(currentDpxBalanceUser0).toString(),
      ],
      [
        'USER2',
        currentDpxBalanceUser2.toString(),
        pastDpxBalanceUser2.sub(currentDpxBalanceUser2).toString(),
      ],
    ]);

    /* === BOOTSTRAP EPOCH 2 === */
    await expect(ssov.connect(owner).bootstrap()).to.emit(ssov, 'Bootstrap');

    const result = await ssov.currentEpoch();

    expect(result.toString()).to.be.equal('2');

    /* === USER1 DEPOSITS === */
    // REF-DEPOSIT-USER1
    // user1 deposit

    // approve
    await dpxToken.connect(user1).approve(ssov.address, user1DepositAmount);

    // deposit - Fails to deposit since current epoch is already bootstrapped
    await expect(
      ssov.connect(user1).deposit(2, user1DepositAmount, user1.address)
    ).to.be.revertedWith('E19');

    // 17. User0, user1, user2 purchases dpx ITM calls (same strike different amounts) for epoch 2
    /* ===  OPTION PURCHASES === */
    const user0PurchaseAmount = expandTo18Decimals(2);
    const user1PurchaseAmount = expandTo18Decimals(4);
    const user2PurchaseAmount = expandTo18Decimals(6);

    // feeDistributor Address
    const feeDistributorAddress = await ssov.getAddress(
      utf8ToHex('FeeDistributor')
    );

    // expiry
    const epoch2Expiry = await ssov.getMonthlyExpiryFromTimestamp(
      block.timestamp
    );

    // premium
    const premiumChargedToUser0Purchase = user0PurchaseAmount
      .mul(
        await optionPricing.getOptionPrice(
          false,
          epoch2Expiry,
          newSetStrikes0,
          await ssov.callStatic.getUsdPrice(),
          100
        )
      )
      .div(usdPrice);

    const premiumChargedToUser1Purchase = user1PurchaseAmount
      .mul(
        await optionPricing.getOptionPrice(
          false,
          epoch2Expiry,
          newSetStrikes1,
          await ssov.callStatic.getUsdPrice(),
          100
        )
      )
      .div(usdPrice);

    const premiumChargedToUser2Purchase = user2PurchaseAmount
      .mul(
        await optionPricing.getOptionPrice(
          false,
          epoch2Expiry,
          newSetStrikes2,
          await ssov.callStatic.getUsdPrice(),
          100
        )
      )
      .div(usdPrice);

    const feesChargedToUser0 = await ssov.calculatePurchaseFees(
      usdPrice,
      newSetStrikes0,
      user0PurchaseAmount
    );
    const feesChargedToUser1 = await ssov.calculatePurchaseFees(
      usdPrice,
      newSetStrikes1,
      user1PurchaseAmount
    );
    const feesChargedToUser2 = await ssov.calculatePurchaseFees(
      usdPrice,
      newSetStrikes2,
      user2PurchaseAmount
    );

    // past balances
    const pastDpxBalanceUser0Epoch2 = await dpxToken.balanceOf(user0.address);
    const pastDpxBalanceUser2Epoch2 = await dpxToken.balanceOf(user2.address);
    const pastDpxBalanceFeeDistributorEpoch2 = await dpxToken.balanceOf(
      feeDistributorAddress
    );

    const totalFeesToFeeDistributor =
      feesChargedToUser0.add(feesChargedToUser2);

    // approval
    await dpxToken
      .connect(user0)
      .approve(
        ssov.address,
        premiumChargedToUser0Purchase.add(feesChargedToUser0)
      );
    await dpxToken
      .connect(user1)
      .approve(
        ssov.address,
        premiumChargedToUser1Purchase.add(feesChargedToUser1)
      );
    await dpxToken
      .connect(user2)
      .approve(
        ssov.address,
        premiumChargedToUser2Purchase.add(feesChargedToUser2)
      );

    // purchase
    // OTM
    await expect(
      ssov.connect(user0).purchase(0, user0PurchaseAmount, user0.address)
    ).to.emit(ssov, 'NewPurchase');

    // OTM but doesn't have liquidity / collateral
    await expect(
      ssov.connect(user1).purchase(1, user1PurchaseAmount, user1.address)
    ).to.be.revertedWith('ERC20: transfer amount exceeds balance');

    // OTM
    await expect(
      ssov.connect(user2).purchase(2, user2PurchaseAmount, user2.address)
    ).to.emit(ssov, 'NewPurchase');

    // compound
    await ssov.connect(user0).compound();
    await ssov.connect(user0).compound();

    // time travelling a day
    timeTravel(86400);

    // compounding after a day
    await ssov.connect(user0).compound();

    // current balances
    const currentDpxBalanceUser0Epoch2 = await dpxToken.balanceOf(
      user0.address
    );
    const currentDpxBalanceUser2Epoch2 = await dpxToken.balanceOf(
      user2.address
    );
    const currentDpxBalanceFeeDistributorEpoch2 = await dpxToken.balanceOf(
      feeDistributorAddress
    );

    // assertion of balances
    // past balance - premium charged - fee charged
    expect(currentDpxBalanceUser0Epoch2).to.be.equal(
      pastDpxBalanceUser0Epoch2
        .sub(premiumChargedToUser0Purchase)
        .sub(feesChargedToUser0)
    );

    expect(currentDpxBalanceUser2Epoch2.toString()).to.be.equal(
      pastDpxBalanceUser2Epoch2
        .sub(premiumChargedToUser2Purchase)
        .sub(feesChargedToUser2)
    );

    // feeDistributor
    expect(currentDpxBalanceFeeDistributorEpoch2.toString()).to.be.equal(
      pastDpxBalanceFeeDistributorEpoch2.add(totalFeesToFeeDistributor)
    );

    // DATA LOGGING
    console.log(
      '===== USERS PURCHASE OPTIONS ========== PREMIUM BREAKDOWN ====='
    );
    console.log('===== PREMIUM BREAKDOWN =====');
    console.table([
      ['ACCOUNT', 'TOTAL PREMIUM', 'PREM WITHOUT FEES', 'FEES CHARGED'],
      [
        'USER0',
        premiumChargedToUser0Purchase.add(feesChargedToUser0).toString(),
        premiumChargedToUser0Purchase.toString(),
        feesChargedToUser0.toString(),
      ],
    ]);
    console.table([
      [
        'USER2',
        premiumChargedToUser2Purchase.add(feesChargedToUser2).toString(),
        premiumChargedToUser2Purchase.toString(),
      ],
    ]);

    console.log('===== USER BALANCES ====');
    console.table([
      [
        'PURCHASED 2 x CALL-1000 (0.5DPX)',
        currentDpxBalanceUser0Epoch2.toString(),
        currentDpxBalanceUser0Epoch2.sub(pastDpxBalanceUser0Epoch2).toString(),
      ],
      [
        'PURCHASED 6 x CALL-50 (0.5DPX)',
        currentDpxBalanceUser2Epoch2.toString(),
        currentDpxBalanceUser2Epoch2.sub(pastDpxBalanceUser2Epoch2).toString(),
      ],
      ['NOTE: USER1 FAILED TO PURCHASE DUE TO NO COLLATERAL IN THE OPTION'],
    ]);

    /* === EXERCISE === */
    /* === FAST FORWARD TO EPOCH EXPIRY === */
    await timeTravel(
      (await ssov.getEpochTimes(await ssov.currentEpoch())).end.toNumber() +
        60 -
        (
          await ethers.provider.getBlock('latest')
        ).timestamp
    );

    await ssov['expireEpoch()']();

    // token Addresses
    const epoch2Strike0TokenAddress = await ssov.epochStrikeTokens(
      epoch2,
      newSetStrikes0
    );
    const epoch2Strike2TokenAddress = await ssov.epochStrikeTokens(
      epoch2,
      newSetStrikes2
    );

    // option token contracts
    const user0ExerciseToken = await ethers.getContractAt(
      erc20Abi,
      epoch2Strike0TokenAddress
    );

    const user2ExerciseToken = await ethers.getContractAt(
      erc20Abi,
      epoch2Strike2TokenAddress
    );

    // past balances
    const pastDpxBalanceUser2AtExercise = await dpxToken.balanceOf(
      user2.address
    );

    // PnL
    const user2PnL = user2PurchaseAmount
      .mul(usdPrice.sub(newSetStrikes2))
      .div(usdPrice);

    const finalPnL = user2PnL;

    // approving
    await epochStrikeToken
      .connect(user0)
      .approve(ssov.address, user0PurchaseAmount);
    await epochStrike2Token
      .connect(user2)
      .approve(ssov.address, user2PurchaseAmount);

    // exercising
    // approve
    await user0ExerciseToken
      .connect(user0)
      .approve(ssov.address, user0PurchaseAmount);

    // strike higher than current price
    await expect(
      ssov.connect(user0).settle(0, user0PurchaseAmount, epoch2)
    ).to.be.revertedWith('E15');

    await user2ExerciseToken
      .connect(user2)
      .approve(ssov.address, user2PurchaseAmount);
    await ssov.connect(user2).settle(2, user2PurchaseAmount, epoch2);

    // current balances
    // user 0
    const currentDpxBalanceUser2AtExercise = await dpxToken.balanceOf(
      user2.address
    );

    // asserting balances
    // past balance + finalPnL
    expect(currentDpxBalanceUser2AtExercise).to.be.equal(
      pastDpxBalanceUser2AtExercise.add(finalPnL.toString())
    );

    console.log('====== PNL ACCOUNTS =====');
    console.table([
      ['OPTION', 'USER', 'PNL', 'PNL WITHOUT FEES'],
      [
        '6 x CALL-50 INDEX(2)',
        'USER2',
        user2PnL.toString(),
        finalPnL.toString(),
      ],
    ]);

    console.log('====== USER BALANCES AFTER EXERCISE ======');
    console.table([
      ['BEFORE', 'AFTER', 'DIFFERENCE'],
      [
        pastDpxBalanceUser2AtExercise.toString(),
        currentDpxBalanceUser2AtExercise.toString(),
        currentDpxBalanceUser2AtExercise
          .sub(pastDpxBalanceUser2AtExercise)
          .toString(),
      ],
    ]);

    /* ==== EXPIRING EPOCH 2 ==== */
    await timeTravel(60 * 60);

    // past data
    const user0BalanceBeforeExpiryEpoch2 = await dpxToken.balanceOf(
      user0.address
    );
    const user2BalanceBeforeExpiryEpoch2 = await dpxToken.balanceOf(
      user2.address
    );

    // compound
    const pastStakingRewardsDpxBalance = await stakingRewardsContract.balanceOf(
      ssov.address
    );

    const pastSsovRewardsDpx = (
      await stakingRewardsContract.earned(ssov.address)
    ).DPXtokensEarned;

    const currentStakingRewardsDpxBalance =
      await stakingRewardsContract.balanceOf(ssov.address);

    const premiumCollected = premiumChargedToUser0Purchase.add(
      premiumChargedToUser2Purchase
    );

    const amountStakedAfterCompound = pastSsovRewardsDpx.add(
      pastStakingRewardsDpxBalance
    );

    // REF-TEMP
    expect(
      currentStakingRewardsDpxBalance.toString().substring(0, 5)
    ).to.be.equal(amountStakedAfterCompound.toString().substring(0, 5));

    console.log('====== TOTAL PREMIUM ======');
    console.log(premiumCollected.toString());

    await dpxToken.connect(owner).approve(ssov.address, MAX_VALUE);

    await ssov.connect(user0).withdraw(epoch2, 2);
    await ssov.connect(user2).withdraw(epoch2, 0);

    // cannot compound after epoch expired
    await expect(ssov.connect(user0).compound()).to.be.revertedWith('E3');

    // current data
    const user0BalanceOnWithdrawEpoch2 = await dpxToken.balanceOf(
      user0.address
    );
    const user2BalanceOnWithdrawEpoch2 = await dpxToken.balanceOf(
      user2.address
    );

    console.log('/===== USERS WITHDRAW =====/');
    console.table([
      [
        'user',
        'Balance before withdraw',
        'balance after withdraw',
        'difference',
      ],
      [
        'USER0',
        user0BalanceBeforeExpiryEpoch2.toString(),
        user0BalanceOnWithdrawEpoch2.toString(),
        user0BalanceOnWithdrawEpoch2
          .sub(user0BalanceBeforeExpiryEpoch2)
          .toString(),
      ],
      [
        'USER2',
        user2BalanceBeforeExpiryEpoch2.toString(),
        user2BalanceOnWithdrawEpoch2.toString(),
        user2BalanceOnWithdrawEpoch2
          .sub(user2BalanceBeforeExpiryEpoch2)
          .toString(),
      ],
    ]);

    // -------------------------------- EPOCH 3 --------------------------------

    const epoch3 = (await ssov.currentEpoch()).add(1);

    await ssov.setStrikes([...strikesEpoch3]);

    await dpxToken.connect(user0).approve(ssov.address, MAX_VALUE);
    await dpxToken.connect(user2).approve(ssov.address, MAX_VALUE);

    await ssov
      .connect(user0)
      .depositMultiple(
        [0, 1],
        [expandTo18Decimals(500), expandTo18Decimals(500)],
        user0.address
      );
    await ssov
      .connect(user2)
      .depositMultiple(
        [1, 2],
        [expandTo18Decimals(500), expandTo18Decimals(500)],
        user2.address
      );

    timeTravel(60 * 60 * 24 * 3); // Time travel 3 days

    await ssov.bootstrap();

    expect(await ssov.totalEpochDeposits(epoch3)).to.be.equal(
      expandTo18Decimals(2000)
    );

    await dpxToken.connect(user1).approve(ssov.address, MAX_VALUE);

    await ssov
      .connect(user1)
      .purchase(0, expandTo18Decimals(10), user1.address);
    await ssov
      .connect(user1)
      .purchase(1, expandTo18Decimals(10), user1.address);
    await ssov
      .connect(user1)
      .purchase(2, expandTo18Decimals(10), user1.address);
  });
});
