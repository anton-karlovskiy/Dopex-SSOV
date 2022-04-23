import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';

import {
  deployMockOptionPricing,
  deployBnbSSOV,
  deployMockChainlinkAggregator,
} from '../helper/contract';
import {
  timeTravel,
  expandTo18Decimals,
  expandToDecimals,
  forkBsc,
} from '../helper/utils';
import {
  ERC20,
  ERC20__factory,
  BnbSSOV,
  IVBNB,
  IVBNB__factory,
  MockChainlinkAggregator,
  MockOptionPricing,
} from '../types';
import { erc20Abi, MAX_VALUE, vbnb } from '../helper/data';

describe('BNB SSOV Integration tests', async () => {
  let signers: SignerWithAddress[];
  let owner: SignerWithAddress;
  let user0: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let optionPricing: MockOptionPricing;
  let ssov: BnbSSOV;
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
  const strikesEpoch3 = [
    expandToDecimals(70, 8),
    expandToDecimals(1500, 8),
    expandToDecimals(2000, 8),
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
      ssov.connect(user0).deposit(0, expandToDecimals(1000, 8), user0.address)
    ).to.emit(ssov, 'NewDeposit');
    await expect(
      ssov.connect(user1).deposit(1, expandToDecimals(300, 8), user1.address)
    ).to.emit(ssov, 'NewDeposit');
    await expect(
      ssov.connect(user2).deposit(2, expandToDecimals(100, 8), user2.address)
    ).to.emit(ssov, 'NewDeposit');

    expect(await ssov.totalEpochDeposits(epoch1)).to.be.equal(
      expandToDecimals(1400, 8)
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
      expandToDecimals(1000, 8)
    );
    expect(await ssov.userEpochDeposits(epoch1, user1Strike)).to.be.equal(
      expandToDecimals(300, 8)
    );
    expect(await ssov.userEpochDeposits(epoch1, user2Strike)).to.be.equal(
      expandToDecimals(100, 8)
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

    expect(await ssov.totalEpochDeposits(epoch1)).to.be.equal(
      expandToDecimals(1400, 8)
    );

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

    // REF-EPOCH2-STRIKES
    const newSetStrikes0 = await ssov.epochStrikes(epoch2, 0);
    const newSetStrikes2 = await ssov.epochStrikes(epoch2, 2);

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

    console.log(
      '===========================\nUSER BALANCES BEFORE DEPOSIT\n==========================='
    );
    console.table([
      ['USER0', pastBalanceUser0.toString()],
      ['USER2', pastBalanceUser2.toString()],
    ]);
    console.log(
      '===========================\nUSER BALANCES AFTER DEPOSIT\n==========================='
    );
    console.table([
      [
        'USER0',
        currentBalanceUser0.toString(),
        pastBalanceUser0.sub(currentBalanceUser0).toString(),
      ],
      [
        'USER2',
        currentBalanceUser2.toString(),
        pastBalanceUser2.sub(currentBalanceUser2).toString(),
      ],
    ]);

    /* === BOOTSTRAP EPOCH 2 === */
    await expect(ssov.connect(owner).bootstrap()).to.emit(ssov, 'Bootstrap');

    const result = await ssov.currentEpoch();

    expect(result.toString()).to.be.equal('2');

    /* === USER1 DEPOSITS === */
    // REF-DEPOSIT-USER1
    // user1 deposit

    // deposit - Fails to deposit since current epoch is already bootstrapped
    await expect(
      ssov.connect(user1).deposit(2, depositAmount, user1.address)
    ).to.be.revertedWith('E19');

    // 17. User0, user1, user2 purchases  ITM calls (same strike different amounts) for epoch 2
    /* ===  OPTION PURCHASES === */
    const user0PurchaseAmount = expandToDecimals(1, 18);
    const user1PurchaseAmount = expandToDecimals(1, 18);
    const user2PurchaseAmount = expandToDecimals(1, 18);

    // premium
    const premiumChargedToUser0Purchase = await ssov.calculatePremium(
      newSetStrikes0,
      user0PurchaseAmount
    );

    const premiumChargedToUser2Purchase = await ssov.calculatePremium(
      newSetStrikes2,
      user2PurchaseAmount
    );

    const feesChargedToUser0 = await ssov.calculatePurchaseFees(
      usdPrice,
      newSetStrikes0,
      user0PurchaseAmount
    );

    const feesChargedToUser2 = await ssov.calculatePurchaseFees(
      usdPrice,
      newSetStrikes2,
      user2PurchaseAmount
    );

    // past balances
    const pastBalanceUser0Epoch2 = await vbnbToken.balanceOf(user0.address);
    const pastBalanceUser2Epoch2 = await vbnbToken.balanceOf(user2.address);

    // fees to feeDistributor according to user purchase
    const feeTofeeDistributorEpoch2FromUser0Purchase = feesChargedToUser0
      .mul(3)
      .div(10);
    const feeTofeeDistributorEpoch2FromUser2Purchase = feesChargedToUser2
      .mul(3)
      .div(10);

    // fees to vault according to user purchase
    const feeToVaultEpoch2FromUser0Purchase = feesChargedToUser0.mul(7).div(10);
    const feeToVaultEpoch2FromUser2Purchase = feesChargedToUser2.mul(7).div(10);

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

    // current balances
    const currentBalanceUser0Epoch2 = await vbnbToken.balanceOf(user0.address);
    const currentBalanceUser2Epoch2 = await vbnbToken.balanceOf(user2.address);

    // assertion of balances
    // past balance - premium charged - fee charged
    expect(currentBalanceUser0Epoch2.toString().substring(0, 4)).to.be.equal(
      pastBalanceUser0Epoch2
        .sub(premiumChargedToUser0Purchase)
        .sub(feesChargedToUser0)
        .toString()
        .substring(0, 4)
    );

    expect(currentBalanceUser2Epoch2.toString().substring(0, 3)).to.be.equal(
      pastBalanceUser2Epoch2
        .sub(premiumChargedToUser2Purchase)
        .sub(feesChargedToUser2)
        .toString()
        .substring(0, 3)
    );

    // DATA LOGGING
    console.log(
      '===== USERS PURCHASE OPTIONS ========== PREMIUM BREAKDOWN ====='
    );
    console.log('===== PREMIUM BREAKDOWN =====');
    console.table([
      [
        'ACCOUNT',
        'TOTAL PREMIUM',
        'PREM WITHOUT FEES',
        'FEES CHARGED',
        'FEE TO VAULT',
        'FEE TO FEE-DISTRIBUTOR',
      ],
      [
        'USER0',
        premiumChargedToUser0Purchase.add(feesChargedToUser0).toString(),
        premiumChargedToUser0Purchase.toString(),
        feesChargedToUser0.toString(),
        feeToVaultEpoch2FromUser0Purchase.toString(),
        feeTofeeDistributorEpoch2FromUser0Purchase.toString(),
      ],
    ]);
    console.table([
      [
        'USER2',
        premiumChargedToUser2Purchase.add(feesChargedToUser2).toString(),
        premiumChargedToUser2Purchase.toString(),
        feesChargedToUser2.toString(),
        feeToVaultEpoch2FromUser2Purchase.toString(),
        feeTofeeDistributorEpoch2FromUser2Purchase.toString(),
      ],
    ]);

    console.log('===== USER BALANCES ====');
    console.table([
      [
        'PURCHASED 2 x CALL-1000 (0.5)',
        currentBalanceUser0Epoch2.toString(),
        currentBalanceUser0Epoch2.sub(pastBalanceUser0Epoch2).toString(),
      ],
      [
        'PURCHASED 6 x CALL-50 (0.5)',
        currentBalanceUser2Epoch2.toString(),
        currentBalanceUser2Epoch2.sub(pastBalanceUser2Epoch2).toString(),
      ],
      ['NOTE: USER1 FAILED TO PURCHASE DUE TO NO COLLATERAL IN THE OPTION'],
    ]);

    /* === SETTLE === */
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
    const user0SettleToken = await ethers.getContractAt(
      erc20Abi,
      epoch2Strike0TokenAddress
    );

    const user2SettleToken = await ethers.getContractAt(
      erc20Abi,
      epoch2Strike2TokenAddress
    );

    // past balances
    const pastBalanceUser2AtSettlement = await vbnbToken.balanceOf(
      user2.address
    );

    // PnL
    const user2PnL = await ssov.calculatePnl(
      await ssov.callStatic.getUsdPrice(),
      newSetStrikes2,
      user2PurchaseAmount
    );

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
    await user0SettleToken
      .connect(user0)
      .approve(ssov.address, user0PurchaseAmount);

    await user2SettleToken
      .connect(user2)
      .approve(ssov.address, user2PurchaseAmount);
    await ssov.connect(user2).settle(2, user2PurchaseAmount, epoch2);

    // current balances
    // user 0
    const currentBalanceUser2AtSettlement = await vbnbToken.balanceOf(
      user2.address
    );

    // asserting balances
    // past balance + finalPnL
    expect(
      currentBalanceUser2AtSettlement.toString().substring(0, 7)
    ).to.be.equal(
      pastBalanceUser2AtSettlement
        .add(finalPnL.toString())
        .toString()
        .substring(0, 7)
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
        pastBalanceUser2AtSettlement.toString(),
        currentBalanceUser2AtSettlement.toString(),
        currentBalanceUser2AtSettlement
          .sub(pastBalanceUser2AtSettlement)
          .toString(),
      ],
    ]);

    /* ==== EXPIRING EPOCH 2 ==== */
    await timeTravel(60 * 60);

    // past data
    const user0BalanceBeforeExpiryEpoch2 = await vbnbToken.balanceOf(
      user0.address
    );
    const user2BalanceBeforeExpiryEpoch2 = await vbnbToken.balanceOf(
      user2.address
    );

    const premiumCollected = premiumChargedToUser0Purchase
      .add(premiumChargedToUser2Purchase)
      .add(feeToVaultEpoch2FromUser0Purchase)
      .add(feeToVaultEpoch2FromUser2Purchase);

    console.log('====== TOTAL PREMIUM ======');
    console.log(premiumCollected.toString());

    await ssov.connect(user0).withdraw(epoch2, 2);
    await ssov.connect(user2).withdraw(epoch2, 0);

    // cannot compound after epoch expired
    // await expect(ssov.connect(user0).compound()).to.be.revertedWith('E3');

    // current data
    const user0BalanceOnWithdrawEpoch2 = await vbnbToken.balanceOf(
      user0.address
    );
    const user2BalanceOnWithdrawEpoch2 = await vbnbToken.balanceOf(
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

    await ssov
      .connect(user0)
      .depositMultiple(
        [0, 1, 2],
        [
          expandToDecimals(500, 8),
          expandToDecimals(500, 8),
          expandToDecimals(500, 8),
        ],
        user0.address
      );

    await ssov
      .connect(user0)
      .depositMultiple(
        [0, 1, 2],
        [
          expandToDecimals(500, 8),
          expandToDecimals(500, 8),
          expandToDecimals(500, 8),
        ],
        user0.address
      );

    timeTravel(60 * 60 * 24 * 3); // Time travel 3 days

    await ssov.bootstrap();

    expect(await ssov.totalEpochDeposits(epoch3)).to.be.equal(
      expandToDecimals(3000, 8)
    );

    await ssov
      .connect(user1)
      .purchase(0, expandToDecimals(10, 18), user1.address);
    await ssov
      .connect(user1)
      .purchase(1, expandToDecimals(10, 18), user1.address);
    await ssov
      .connect(user1)
      .purchase(2, expandToDecimals(10, 18), user1.address);
  });
});
