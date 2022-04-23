import { expect } from 'chai';
import { BigNumber, Signer } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';

import {
  deployPriceOracleAggregator,
  deployMockDPXChainlinkUSDAdapter,
  deployMockOptionPricing,
  deployMainnetEthSSOV,
} from '../helper/contract';
import {
  timeTravel,
  expandTo18Decimals,
  expandToDecimals,
  unlockAccount,
} from '../helper/utils';
import {
  MockOptionPricing,
  PriceOracleAggregator,
  MainnetEthSSOV,
} from '../types';
import {
  erc20Abi,
  MAX_VALUE,
  weth,
  wethHolders,
  curve,
  yearn,
  steCRV,
} from '../helper/data';

/* 
    Owner, user1 and user2 accounts are initialized with 10k  each.

    Epoch initially at 0 before first bootstrap. 
    
    1. SSOV contract owner sets 3 strike prices for the first epoch. All 3 strikes are ITM
    2. Users 0, 1, 2 deposit 1000, 500, 100  for the coming epoch to strike indices 0, 1 & 2 respectively
    3. Owner bootstraps the SSOV. Current epoch updated from 0 to 1
    4. User 1 attempts to withdraw for ongoing epoch
    5. Users 0, 1, 2 purchase  calls at strikeIndices 0, 1, 2
       Check premium and fee calculations for each user
    6. Fast forward to epoch 1 expiry
    7. User 1's, User 0 settle. User 2 does not settle
       Check pnl calculations of user0, user1, user2
    8. STUB
    9. Check deposited  balances of user0, user1, user2 after epoch expiry
    10. User0 & user2 withdraw before the start of the next epoch. user1 does not withdraw from epoch 1
    11. Owner sets strikes for next epoch (epoch 2). 2 strikes OTM, 1 strike ITM
    12. User0 & user2 deposit to next epoch to strikeIndices 2 (ITM) and 0 (OTM) respectively
    13. STUB
    14. Owner bootstraps epoch 2
    15. User1 deposits  after bootstrap of epoch 2 (to epoch 3) to strikeIndex 2
    16. User2 emergency withdraws from epoch 2.
    17. User0, user1, user2 purchases  ITM calls (same strike different amounts) for epoch 2
    18. Fast forward to expiry
    19. User0, user1, user2 settle  calls
        Check pnl calculations for users
        Check staked balance of user0. It must be less than deposited amount if staked amount + premium + fee < settle pnl
    20. STUB
    21. Check deposited  balances (User0 balance before epoch 2 start and after end)
    22. User0 withdraws 
    23. User0, user2 deposit to epoch 3 for multiple strikes; strikeIndex 0, 1, 2 & 2 and 0, 1, 2. StrikeIndex 0 is ITM, 1 & 2 OTM
    24. User1 purchases for all 3 strikes
*/

describe('Mainnet ETH SSOV Integration tests', async () => {
  let signers: SignerWithAddress[];
  let owner: SignerWithAddress;
  let user0: Signer;
  let user1: Signer;
  let user2: Signer;
  let optionPricing: MockOptionPricing;
  let ssov: MainnetEthSSOV;
  let priceOracleAggregator: PriceOracleAggregator;

  const provider = ethers.provider;
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
    await unlockAccount(wethHolders[0]);
    await signers[1].sendTransaction({
      to: wethHolders[0],
      value: expandTo18Decimals(500),
    });
    user0 = await ethers.provider.getSigner(wethHolders[0]);

    await unlockAccount(wethHolders[1]);
    await signers[2].sendTransaction({
      to: wethHolders[1],
      value: expandTo18Decimals(500),
    });
    user1 = await ethers.provider.getSigner(wethHolders[1]);

    await unlockAccount(wethHolders[2]);
    await signers[3].sendTransaction({
      to: wethHolders[2],
      value: expandTo18Decimals(500),
    });
    user2 = await ethers.provider.getSigner(wethHolders[2]);

    // Chainlink Price Aggregator
    priceOracleAggregator = await deployPriceOracleAggregator();

    // Mock WETH Chainlink USD Adapter
    const mockERC20ChainlinkUSDAdapter =
      await deployMockDPXChainlinkUSDAdapter();

    await priceOracleAggregator.updateOracleForAsset(
      weth,
      mockERC20ChainlinkUSDAdapter.address
    );

    await priceOracleAggregator.getPriceInUSD(weth);

    // Mock Option Pricing
    optionPricing = await deployMockOptionPricing();

    const MockVolatilityOracle = await ethers.getContractFactory(
      'MockVolatilityOracle'
    );

    const mockVolatilityOracle = await MockVolatilityOracle.deploy();

    // SSOV
    ssov = await deployMainnetEthSSOV(
      weth,
      steCRV,
      curve,
      yearn,
      optionPricing.address,
      priceOracleAggregator.address,
      mockVolatilityOracle.address,
      '0x8A98954DBD6Ca2F446e78F29eC9497D0a4601074'
    );
  });

  it('Tests from epoch 1 through 3', async () => {
    const epoch1 = (await ssov.currentEpoch()).add(1); // Epoch 1
    const user0Address = await user0.getAddress();
    const user1Address = await user1.getAddress();
    const user2Address = await user2.getAddress();

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

    // 2. Users 0, 1, 2 deposit 1000  for the coming epoch to strike indices 0, 1 & 2 respectively

    await expect(
      ssov.connect(user0).deposit(0, user0Address, {
        value: expandTo18Decimals(1000),
      })
    ).to.emit(ssov, 'NewDeposit');
    await expect(
      ssov.connect(user1).deposit(1, user1Address, {
        value: expandTo18Decimals(500),
      })
    ).to.emit(ssov, 'NewDeposit');
    await expect(
      ssov.connect(user2).deposit(2, user2Address, {
        value: expandTo18Decimals(100),
      })
    ).to.emit(ssov, 'NewDeposit');

    expect(await ssov.totalEpochDeposits(epoch1)).to.be.equal(
      expandTo18Decimals(1600)
    );

    const strike1 = await ssov.epochStrikes(epoch1, 0);
    const user0Strike = ethers.utils.solidityKeccak256(
      ['address', 'uint256'],
      [user0Address, strike1]
    );

    const strike2 = await ssov.epochStrikes(epoch1, 1);
    const user1Strike = ethers.utils.solidityKeccak256(
      ['address', 'uint256'],
      [user1Address, strike2]
    );
    const strike3 = await ssov.epochStrikes(epoch1, 2);
    const user2Strike = ethers.utils.solidityKeccak256(
      ['address', 'uint256'],
      [user2Address, strike3]
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
      5. Users 0, 1, 2 purchase  calls at strikeIndices 0, 1, 2
         Check premium and fee calculations for each user
    */

    const purchaseAmountEpoch1 = expandTo18Decimals(10);
    const block = await ethers.provider.getBlock(
      await ethers.provider.getBlockNumber()
    );
    const strike = await ssov.epochStrikes(epoch1, 0);
    const expiry = await ssov.getMonthlyExpiryFromTimestamp(block.timestamp);
    const usdPrice = await priceOracleAggregator.viewPriceInUSD(weth);
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

    const fees = await ssov.calculateFees(
      usdPrice,
      strike1,
      purchaseAmountEpoch1
    );
    const fees2 = await ssov.calculateFees(
      usdPrice,
      strike2,
      purchaseAmountEpoch1
    );
    const fees3 = await ssov.calculateFees(
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
      user0Address
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
      ssov.connect(user0).purchase(0, purchaseAmountEpoch1, user0Address, {
        value: premium.add(fees),
      })
    ).to.emit(ssov, 'NewPurchase');

    expect(pastTotalEpochPremiumMinusFee).to.be.equal('1500000000000000000'); // 1.5  in total premiums

    await expect(
      ssov.connect(user1).purchase(2, purchaseAmountEpoch1, user1Address, {
        value: premium3.add(fees3),
      })
    ).to.emit(ssov, 'NewPurchase');

    await expect(
      ssov.connect(user2).purchase(1, purchaseAmountEpoch1, user2Address, {
        value: premium2.add(fees2),
      })
    ).to.emit(ssov, 'NewPurchase');

    expect(await epochStrikeToken.balanceOf(user0Address)).to.be.equal(
      purchaseAmountEpoch1
    );

    expect(await epochStrike2Token.balanceOf(user2Address)).to.be.equal(
      purchaseAmountEpoch1
    );

    expect(await epochStrike3Token.balanceOf(user1Address)).to.be.equal(
      purchaseAmountEpoch1
    );

    // Current Data
    const currentEpochStrikeTokenBalanceOfVault =
      await epochStrikeToken.balanceOf(ssov.address);

    expect(currentEpochStrikeTokenBalanceOfVault).to.be.equal(
      pastEpochStrikeTokenBalanceOfVault.sub(purchaseAmountEpoch1)
    );

    const currentEpochStrikeTokenBalanceOfUser =
      await epochStrikeToken.balanceOf(user0Address);

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

    await ssov.expireEpoch();

    // 7. User 0 and User 1 settle. User 2 does not settle
    //    Check pnl calculations of user0, user1, user2
    await epochStrikeToken.connect(user0).approve(ssov.address, MAX_VALUE);
    await epochStrike3Token.connect(user1).approve(ssov.address, MAX_VALUE);

    const user0BalanceBeforeSettlement = await provider.getBalance(
      user0Address
    );

    await ssov.connect(user0).settle(0, purchaseAmountEpoch1, epoch1);

    const user0BalanceAfterSettlement = await provider.getBalance(user0Address);

    // pnl for user0
    expect(
      user0BalanceAfterSettlement
        .sub(user0BalanceBeforeSettlement)
        .toString()
        .substring(0, 3)
    ).to.be.equal('499');

    await ssov.connect(user1).settle(2, purchaseAmountEpoch1, epoch1);

    await timeTravel(60 * 60);

    // 9. Check deposited  balances of user0, user1, user2 after epoch expiry

    expect(await ssov.totalEpochDeposits(epoch1)).to.be.equal(
      expandTo18Decimals(1600)
    );

    const user0BalanceBeforeWithdraw = await provider.getBalance(user0Address);
    const user2BalanceBeforeWithdraw = await provider.getBalance(user2Address);

    // 10. User0 & user2 withdraw before the start of the next epoch. user1 does not withdraw from epoch 1

    await ssov.connect(user0).withdraw(epoch1, 0);
    await ssov.connect(user2).withdraw(epoch1, 2);

    const user0BalanceAfterWithdraw = await provider.getBalance(user0Address);

    const user2BalanceAfterWithdraw = await provider.getBalance(user2Address);

    expect(
      user0BalanceAfterWithdraw
        .sub(user0BalanceBeforeWithdraw)
        .toString()
        .substring(0, 4)
    ).to.be.equal(
      BigNumber.from('995000140000000000000').toString().substring(0, 4)
    );

    expect(
      user2BalanceAfterWithdraw
        .sub(user2BalanceBeforeWithdraw)
        .toString()
        .substring(0, 4)
    ).to.be.equal(
      BigNumber.from('98450140000000000000').toString().substring(0, 4)
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
      [user0Address, strike0forEpoch2]
    );
    const user0StrikeEpoch2 = ethers.utils.solidityKeccak256(
      ['address', 'uint256'],
      [user2Address, strike2forEpoch2]
    );

    const depositAmount = expandTo18Decimals(300);

    // past  balances of user0 and user2
    const pastBalanceUser0 = await provider.getBalance(user0Address);
    const pastBalanceUser2 = await provider.getBalance(user2Address);

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
      ssov.connect(user0).deposit(2, user0Address, {
        value: depositAmount,
      })
    ).to.emit(ssov, 'NewDeposit');

    // time travelling 1 day
    timeTravel(86400);

    // user2 deposit
    await expect(
      ssov.connect(user2).deposit(0, user2Address, {
        value: depositAmount,
      })
    ).to.emit(ssov, 'NewDeposit');

    // current balances of users
    const currentBalanceUser0 = await provider.getBalance(user0Address);
    const currentBalanceUser2 = await provider.getBalance(user2Address);

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
    expect(currentBalanceUser0.toString().substring(0, 7)).to.be.equal(
      pastBalanceUser0.sub(depositAmount).toString().substring(0, 7)
    );

    expect(currentBalanceUser2.toString().substring(0, 7)).to.be.equal(
      pastBalanceUser2.sub(depositAmount).toString().substring(0, 7)
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
      ssov.connect(user1).deposit(2, user1Address, {
        value: depositAmount,
      })
    ).to.be.revertedWith('E19');

    // 17. User0, user1, user2 purchases  ITM calls (same strike different amounts) for epoch 2
    /* ===  OPTION PURCHASES === */
    const user0PurchaseAmount = expandTo18Decimals(2);
    const user1PurchaseAmount = expandTo18Decimals(4);
    const user2PurchaseAmount = expandTo18Decimals(6);

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
          await ssov.callStatic.getUsdPrice(weth),
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
          await ssov.callStatic.getUsdPrice(weth),
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
          await ssov.callStatic.getUsdPrice(weth),
          100
        )
      )
      .div(usdPrice);

    const feesChargedToUser0 = await ssov.calculateFees(
      usdPrice,
      newSetStrikes0,
      user0PurchaseAmount
    );
    const feesChargedToUser1 = await ssov.calculateFees(
      usdPrice,
      newSetStrikes1,
      user1PurchaseAmount
    );
    const feesChargedToUser2 = await ssov.calculateFees(
      usdPrice,
      newSetStrikes2,
      user2PurchaseAmount
    );

    // past balances
    const pastBalanceUser0Epoch2 = await provider.getBalance(user0Address);
    const pastBalanceUser2Epoch2 = await provider.getBalance(user2Address);

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
      ssov.connect(user0).purchase(0, user0PurchaseAmount, user0Address, {
        value: premiumChargedToUser0Purchase.add(feesChargedToUser0),
      })
    ).to.emit(ssov, 'NewPurchase');

    // OTM but doesn't have liquidity / collateral
    await expect(
      ssov.connect(user1).purchase(1, user1PurchaseAmount, user1Address, {
        value: premiumChargedToUser1Purchase.add(feesChargedToUser1),
      })
    ).to.be.revertedWith('ERC20: transfer amount exceeds balance');

    // OTM
    await expect(
      ssov.connect(user2).purchase(2, user2PurchaseAmount, user2Address, {
        value: premiumChargedToUser2Purchase.add(feesChargedToUser2),
      })
    ).to.emit(ssov, 'NewPurchase');

    // compound
    await ssov.connect(user0).compound();

    // time travelling a day
    timeTravel(86400);

    // current balances
    const currentBalanceUser0Epoch2 = await provider.getBalance(user0Address);
    const currentBalanceUser2Epoch2 = await provider.getBalance(user2Address);

    // assertion of balances
    // past balance - premium charged - fee charged
    expect(currentBalanceUser0Epoch2.toString().substring(0, 8)).to.be.equal(
      pastBalanceUser0Epoch2
        .sub(premiumChargedToUser0Purchase)
        .sub(feesChargedToUser0)
        .toString()
        .substring(0, 8)
    );

    expect(currentBalanceUser2Epoch2.toString().substring(0, 8)).to.be.equal(
      pastBalanceUser2Epoch2
        .sub(premiumChargedToUser2Purchase)
        .sub(feesChargedToUser2)
        .toString()
        .substring(0, 8)
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

    await ssov.expireEpoch();

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
    const pastBalanceUser2AtSettlement = await provider.getBalance(
      user2Address
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
    await user0SettleToken
      .connect(user0)
      .approve(ssov.address, user0PurchaseAmount);

    // strike higher than current price
    await expect(
      ssov.connect(user0).settle(0, user0PurchaseAmount, epoch2)
    ).to.be.revertedWith('E15');

    await user2SettleToken
      .connect(user2)
      .approve(ssov.address, user2PurchaseAmount);
    await ssov.connect(user2).settle(2, user2PurchaseAmount, epoch2);

    // current balances
    // user 0
    const currentBalanceUser2AtSettlement = await provider.getBalance(
      user2Address
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
    const user0BalanceBeforeExpiryEpoch2 = await provider.getBalance(
      user0Address
    );
    const user2BalanceBeforeExpiryEpoch2 = await provider.getBalance(
      user2Address
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
    await expect(ssov.connect(user0).compound()).to.be.revertedWith('E3');

    // current data
    const user0BalanceOnWithdrawEpoch2 = await provider.getBalance(
      user0Address
    );
    const user2BalanceOnWithdrawEpoch2 = await provider.getBalance(
      user2Address
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
          expandTo18Decimals(500),
          expandTo18Decimals(500),
          expandTo18Decimals(500),
        ],
        user0Address,
        { value: expandTo18Decimals(1500) }
      );

    await ssov
      .connect(user0)
      .depositMultiple(
        [0, 1, 2],
        [
          expandTo18Decimals(500),
          expandTo18Decimals(500),
          expandTo18Decimals(500),
        ],
        user0Address,
        { value: expandTo18Decimals(1500) }
      );

    timeTravel(60 * 60 * 24 * 3); // Time travel 3 days

    await ssov.bootstrap();

    expect(await ssov.totalEpochDeposits(epoch3)).to.be.equal(
      expandTo18Decimals(3000)
    );

    // expiry
    const epoch3Expiry = await ssov.getMonthlyExpiryFromTimestamp(
      block.timestamp
    );

    // REF-EPOCH2-STRIKES
    const newSetStrikes0Epoch3 = await ssov.epochStrikes(epoch3, 0);
    const newSetStrikes1Epoch3 = await ssov.epochStrikes(epoch3, 1);
    const newSetStrikes2Epoch3 = await ssov.epochStrikes(epoch3, 2);

    // premium
    const premiumChargedToUser1PurchaseEpoch3 = expandTo18Decimals(10)
      .mul(
        await optionPricing.getOptionPrice(
          false,
          epoch3Expiry,
          newSetStrikes0Epoch3,
          await ssov.callStatic.getUsdPrice(weth),
          100
        )
      )
      .div(usdPrice);

    const premiumChargedToUser1Strike1PurchaseEpoch3 = expandTo18Decimals(10)
      .mul(
        await optionPricing.getOptionPrice(
          false,
          epoch3Expiry,
          newSetStrikes1Epoch3,
          await ssov.callStatic.getUsdPrice(weth),
          100
        )
      )
      .div(usdPrice);

    const premiumChargedToUser1Strike2PurchaseEpoch3 = expandTo18Decimals(10)
      .mul(
        await optionPricing.getOptionPrice(
          false,
          epoch3Expiry,
          newSetStrikes2Epoch3,
          await ssov.callStatic.getUsdPrice(weth),
          100
        )
      )
      .div(usdPrice);

    const feesChargedToUser1Epoch3 = await ssov.calculateFees(
      usdPrice,
      newSetStrikes2Epoch3,
      expandTo18Decimals(10)
    );

    await ssov
      .connect(user1)
      .purchase(0, expandTo18Decimals(10), user1Address, {
        value: premiumChargedToUser1PurchaseEpoch3.add(
          feesChargedToUser1Epoch3
        ),
      });
    await ssov
      .connect(user1)
      .purchase(1, expandTo18Decimals(10), user1Address, {
        value: premiumChargedToUser1Strike1PurchaseEpoch3.add(
          feesChargedToUser1Epoch3
        ),
      });
    await ssov
      .connect(user1)
      .purchase(2, expandTo18Decimals(10), user1Address, {
        value: premiumChargedToUser1Strike2PurchaseEpoch3.add(
          feesChargedToUser1Epoch3
        ),
      });
  });
});
