import { expect } from 'chai';
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
  DpxToken,
  RdpxToken,
  PriceOracleAggregator,
} from '../types';
import { erc20Abi } from '../helper/data';

const utf8ToHex = (str: string) =>
  web3Utils.rightPad(ethers.utils.hexlify(ethers.utils.toUtf8Bytes(str)), 64);

describe('SSOV tests', async () => {
  let signers: SignerWithAddress[];
  let owner: SignerWithAddress;
  let user0: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let dpxToken: DpxToken;
  let rdpxToken: RdpxToken;
  let stakingRewardsContract: StakingRewards;
  let optionPricing: MockOptionPricing;
  let ssov: DpxSSOVV2;
  let priceOracleAggregator: PriceOracleAggregator;
  const strikes = [
    expandToDecimals(80, 8),
    expandToDecimals(120, 8),
    expandToDecimals(150, 8),
    0,
  ];

  // Contract Setup
  before(async () => {
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

    await dpxToken.mint(await user0.getAddress(), expandTo18Decimals(10000));
    await dpxToken.mint(await user1.getAddress(), expandTo18Decimals(10000));
    await dpxToken.mint(await user2.getAddress(), expandTo18Decimals(10000));

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

  // Contract Info
  describe('SSOV Contract Info', async () => {
    // DPX/rDPX/StakingRewards
    it('DPX/rDPX/StakingRewards Address', async () => {
      expect(
        (await ssov.getAddress(utf8ToHex('DPX'))).toString().toLowerCase()
      ).to.equal(dpxToken.address.toLowerCase());
      expect(
        (await ssov.getAddress(utf8ToHex('rDPX'))).toString().toLowerCase()
      ).to.equal(rdpxToken.address.toLowerCase());
      expect(
        (await ssov.getAddress(utf8ToHex('StakingRewards')))
          .toString()
          .toLowerCase()
      ).to.equal(stakingRewardsContract.address.toLowerCase());
    });
  });

  // Strikes
  describe('SSOV Strikes', async () => {
    // Set Strikes OnlyOwner
    it('Set Strikes OnlyOwner', async () => {
      await expect(ssov.connect(user0).setStrikes([120])).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });

    // Set Strikes
    it('Set Strikes Success', async () => {
      await ssov.connect(owner).setStrikes(strikes);

      expect(await ssov.epochStrikes(1, 0)).to.equal(strikes[0]);
      expect(await ssov.epochStrikes(1, 1)).to.equal(strikes[1]);
      expect(await ssov.epochStrikes(1, 2)).to.equal(strikes[2]);
    });
  });

  // Deposit Single/Multiple
  describe('Deposit Single/Multiple', async () => {
    // Deposit with wrong strike
    it('Deposit with wrong strike', async () => {
      await expect(
        ssov.connect(user0).deposit(3, 100, user0.address)
      ).to.be.revertedWith('E12');

      await expect(
        ssov.connect(user0).deposit(4, 100, user0.address)
      ).to.be.revertedWith('E10');
    });

    // Deposit single
    it('Deposit single & userEpochDeposits/totalEpochStrikeDeposits/totalEpochDeposits', async () => {
      const amount0 = expandTo18Decimals(10);
      const user0Address = await user0.getAddress();
      const epoch = (await ssov.currentEpoch()).add(1);
      const strike = await ssov.epochStrikes(epoch, 0);
      const userStrike = ethers.utils.solidityKeccak256(
        ['address', 'uint256'],
        [user0Address, strike]
      );

      // Past Data
      const pastBalance = await dpxToken.balanceOf(user0Address);
      const pastUserEpochDeposits = await ssov.userEpochDeposits(
        epoch,
        userStrike
      );
      const pastTotalEpochStrikeDeposits = await ssov.totalEpochStrikeDeposits(
        epoch,
        strike
      );
      const pastTotalEpochDeposits = await ssov.totalEpochDeposits(epoch);

      // Approve
      await dpxToken.connect(user0).approve(ssov.address, amount0);

      // Deposit & Event
      await expect(
        ssov.connect(user0).deposit(0, amount0, user0.address)
      ).to.emit(ssov, 'NewDeposit');

      // approve
      await dpxToken.connect(user2).approve(ssov.address, amount0);

      // user2 depositing for emergency withdraw testing
      await expect(
        ssov.connect(user2).deposit(0, amount0, user2.address)
      ).to.emit(ssov, 'NewDeposit');

      // Current Data
      const currentUser0Balance = await dpxToken.balanceOf(user0Address);

      expect(currentUser0Balance).to.equal(pastBalance.sub(amount0));

      const currentUserEpochDeposits = await ssov.userEpochDeposits(
        epoch,
        userStrike
      );

      expect(currentUserEpochDeposits).to.equal(
        pastUserEpochDeposits.add(amount0)
      );

      const currentTotalEpochStrikeDeposits =
        await ssov.totalEpochStrikeDeposits(epoch, strike);
      expect(currentTotalEpochStrikeDeposits).to.equal(
        pastTotalEpochStrikeDeposits.add(amount0.mul(2))
      );

      const currentTotalEpochDeposits = await ssov.totalEpochDeposits(epoch);
      expect(currentTotalEpochDeposits).to.equal(
        pastTotalEpochDeposits.add(amount0.mul(2))
      );
    });

    // Deposit multiple
    it('Deposit multiple', async () => {
      const amount0 = expandTo18Decimals(15);
      const amount1 = expandTo18Decimals(25);
      const pastBalance = await dpxToken.balanceOf(await user1.getAddress());

      // Approve
      await dpxToken.connect(user1).approve(ssov.address, amount0.add(amount1));

      // Deposit
      await ssov
        .connect(user1)
        .depositMultiple([1, 2], [amount0, amount1], user1.address);

      // Balance
      const currentBalance = await dpxToken.balanceOf(await user1.getAddress());
      expect(currentBalance).to.equal(pastBalance.sub(amount0.add(amount1)));
    });
  });

  // Bootstrap
  describe('Bootstrap', async () => {
    // Bootstrap OnlyOwner
    it('Bootstrap OnlyOwner', async () => {
      await expect(ssov.connect(user0).bootstrap()).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });

    it('purchase should fail if ssov is not bootstrapped', async () => {
      await expect(
        ssov.connect(user1).purchase(1, 1, user1.address)
      ).to.be.revertedWith('E20');
    });

    it('compound should fail if epoch is not bootstrapped', async () => {
      await expect(ssov.connect(user1).compound()).to.be.revertedWith('E20');
    });

    // Bootstrap EpochStrikeTokens
    it('Bootstrap EpochStrikeTokens name/symbol/amount', async () => {
      const pastEpoch = await ssov.currentEpoch();
      await ssov.connect(owner).bootstrap();
      const currentEpoch = await ssov.currentEpoch();
      expect(currentEpoch).to.equal(pastEpoch.add(1));
      for (let i = 0; i < 3; i++) {
        const epochStrikeTokenAddress = await ssov.epochStrikeTokens(
          currentEpoch,
          strikes[i]
        );
        const epochStrikeToken = await ethers.getContractAt(
          erc20Abi,
          epochStrikeTokenAddress
        );

        expect(await epochStrikeToken.name()).to.equal(
          `DPX-CALL${strikes[i]}-EPOCH-${currentEpoch}`
        );

        expect(await epochStrikeToken.symbol()).to.equal(
          `DPX-CALL${strikes[i]}-EPOCH-${currentEpoch}`
        );

        expect(await epochStrikeToken.balanceOf(ssov.address)).to.equal(
          await ssov.totalEpochStrikeDeposits(currentEpoch, strikes[i])
        );
      }
    });

    it('Compound by any user', async () => {
      timeTravel(86400);

      const pastStakingRewardsBalanceOfVault =
        await stakingRewardsContract.balanceOf(ssov.address);

      const pastSsovRewards = await stakingRewardsContract.rewardsDPX(
        ssov.address
      );

      await expect(ssov.compound()).to.emit(ssov, 'Compound');

      const stakingRewardsBalanceOfVault =
        await stakingRewardsContract.balanceOf(ssov.address);

      expect(
        Number(
          stakingRewardsBalanceOfVault.div(
            pastStakingRewardsBalanceOfVault.add(pastSsovRewards)
          )
        )
      ).to.be.equal(1);
    });

    // Bootstrap with not expired previous epoch
    it('Bootstrap with not expired previous epoch', async () => {
      const currentEpoch = (await ssov.currentEpoch()).toNumber();
      timeTravel(
        (await ssov.getEpochTimes(currentEpoch)).end.toNumber() +
          60 -
          (await (
            await ethers.provider.getBlock('latest')
          ).timestamp)
      );
      // Set Strikes & Bootstrap
      await ssov.connect(owner).setStrikes(strikes);
      await expect(ssov.connect(owner).bootstrap()).to.be.revertedWith('E7');
    });
  });

  // Expire
  describe('Expire', async () => {
    it('deposit should fail if current epoch (other than 0) is not expired and the following epoch is bootstrapped', async () => {
      await expect(
        ssov.connect(user0).deposit(3, 100, user0.address)
      ).to.be.revertedWith('E19');
    });

    // Expire epoch
    it('Expire epoch', async () => {
      await ssov['expireEpoch()']();
    });

    // Expire epoch again
    it('Expire epoch again', async () => {
      await expect(ssov.connect(owner)['expireEpoch()']()).to.be.revertedWith(
        'E3'
      );
    });

    // Expire before epoch's expiry
    it("Expire before epoch's expiry", async () => {
      // Set Strikes & Bootstrap
      await ssov.connect(owner).setStrikes(strikes);

      // Deposit
      const amount0 = expandTo18Decimals(15);
      const amount1 = expandTo18Decimals(25);

      // Approve
      await dpxToken.connect(user1).approve(ssov.address, amount0.add(amount1));

      // Deposit
      await ssov
        .connect(user1)
        .depositMultiple([0, 1], [amount0, amount1], user1.address);

      await ssov.connect(owner).bootstrap();

      await expect(ssov.connect(owner)['expireEpoch()']()).to.be.revertedWith(
        'E4'
      );
    });
  });

  describe('Pause SSOV', async () => {
    it('should revert if pause() sender is not governance', async () => {
      await expect(ssov.connect(user0).pause()).to.be.revertedWith('E22');
    });

    it('should revert on emergency withdraw if sender is not governance', async () => {
      await expect(ssov.connect(user0).emergencyWithdraw()).to.be.revertedWith(
        'E22'
      );
    });

    it('should revert on emergency withdraw if vault is not paused', async () => {
      await expect(ssov.emergencyWithdraw()).to.be.revertedWith(
        'Pausable: not paused'
      );
    });

    it('should pause the ssov', async () => {
      await expect(ssov.connect(owner).pause()).to.emit(ssov, 'Paused');

      const pauseStatus = await ssov.paused();

      expect(pauseStatus).to.be.equal(true);
    });

    it('should successfully emergency withdraw', async () => {
      const oldDpxBalanceOwner = await dpxToken.balanceOf(owner.address);
      const oldRdpxBalanceOwner = await rdpxToken.balanceOf(owner.address);

      const dpxBalanceSsov = await dpxToken.balanceOf(ssov.address);
      const rdpxBalanceSsov = await rdpxToken.balanceOf(ssov.address);

      await ssov.emergencyWithdraw();

      const newDpxBalanceOwner = await dpxToken.balanceOf(owner.address);
      const newRdpxBalanceOwner = await rdpxToken.balanceOf(owner.address);

      expect(newDpxBalanceOwner).to.equal(
        oldDpxBalanceOwner.add(dpxBalanceSsov)
      );

      expect(newRdpxBalanceOwner).to.equal(
        oldRdpxBalanceOwner.add(rdpxBalanceSsov)
      );
    });

    it('should unpause the ssov', async () => {
      await expect(ssov.connect(owner).unpause()).to.emit(ssov, 'Unpaused');

      const pauseStatus = await ssov.paused();

      expect(pauseStatus).to.be.equal(false);
    });
  });

  // Purchase
  describe('Purchase', async () => {
    // Purchase Invalid Strike
    it('Purchase Invalid Strike', async () => {
      await expect(
        ssov.connect(user0).purchase(4, 10, user0.address)
      ).to.be.revertedWith('E10');
      await expect(
        ssov.connect(user0).purchase(3, 10, user0.address)
      ).to.be.revertedWith('E12');
    });

    // Purchase
    it('Purchase by user0', async () => {
      const amount = expandTo18Decimals(5);
      const user0Address = await user0.getAddress();
      const epoch = await ssov.currentEpoch();
      const strike = await ssov.epochStrikes(epoch, 0);
      const userStrike = ethers.utils.solidityKeccak256(
        ['address', 'uint256'],
        [user0Address, strike]
      );
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber()
      );
      const expiry = await ssov.getMonthlyExpiryFromTimestamp(block.timestamp);
      const usdPrice = await priceOracleAggregator.viewPriceInUSD(
        dpxToken.address
      );
      const premium = amount
        .mul(
          await optionPricing.getOptionPrice(
            false,
            expiry,
            strike,
            await ssov.callStatic.getUsdPrice(),
            100
          )
        )
        .div(usdPrice);

      // fee calculated from contract
      const feesCalculatedFromContract = await ssov.calculatePurchaseFees(
        usdPrice,
        strike,
        amount
      );

      const totalPremium = premium.add(feesCalculatedFromContract);

      const feeToDistributor = feesCalculatedFromContract;

      // Epoch Strike Token
      const epochStrikeTokenAddress = await ssov.epochStrikeTokens(
        epoch,
        strike
      );
      const epochStrikeToken = await ethers.getContractAt(
        erc20Abi,
        epochStrikeTokenAddress
      );

      // Past Data
      const pastEpochStrikeTokenBalanceOfVault =
        await epochStrikeToken.balanceOf(ssov.address);

      const pastEpochStrikeTokenBalanceOfUser =
        await epochStrikeToken.balanceOf(user0Address);

      const pastDpxTokenBalanceOfUser = await dpxToken.balanceOf(user0Address);
      const pastTotalEpochCallsPurchased = await ssov.totalEpochCallsPurchased(
        epoch,
        strike
      );
      const pastUserEpochCallsPurchased = await ssov.userEpochCallsPurchased(
        epoch,
        userStrike
      );
      const pastTotalEpochPremium = await ssov.totalEpochPremium(epoch, strike);

      const pastUserEpochPremium = await ssov.userEpochPremium(
        epoch,
        userStrike
      );

      // Purchase & Event
      await dpxToken.connect(user0).approve(ssov.address, totalPremium);

      await expect(
        ssov.connect(user0).purchase(0, amount, user0.address)
      ).to.emit(ssov, 'NewPurchase');

      // FeeDistributor balance after purchase by user0
      const feeDistributorBalance = await dpxToken.balanceOf(
        await ssov.getAddress(utf8ToHex('FeeDistributor'))
      );

      // check if fee distributor has received fees
      expect(feeDistributorBalance).to.be.equal(feeToDistributor);

      // Current Data
      const currentEpochStrikeTokenBalanceOfVault =
        await epochStrikeToken.balanceOf(ssov.address);
      expect(currentEpochStrikeTokenBalanceOfVault).to.equal(
        pastEpochStrikeTokenBalanceOfVault.sub(amount)
      );

      const currentEpochStrikeTokenBalanceOfUser =
        await epochStrikeToken.balanceOf(user0Address);
      expect(currentEpochStrikeTokenBalanceOfUser).to.equal(
        pastEpochStrikeTokenBalanceOfUser.add(amount)
      );

      const currentDpxTokenBalanceOfUser = await dpxToken.balanceOf(
        user0Address
      );

      expect(currentDpxTokenBalanceOfUser).to.equal(
        pastDpxTokenBalanceOfUser.sub(totalPremium)
      );

      const currentTotalEpochCallsPurchased =
        await ssov.totalEpochCallsPurchased(epoch, strike);
      expect(currentTotalEpochCallsPurchased).to.equal(
        pastTotalEpochCallsPurchased.add(amount)
      );

      const currentUserEpochCallsPurchased = await ssov.userEpochCallsPurchased(
        epoch,
        userStrike
      );
      expect(currentUserEpochCallsPurchased).to.equal(
        pastUserEpochCallsPurchased.add(amount)
      );

      const currentTotalEpochPremium = await ssov.totalEpochPremium(
        epoch,
        strike
      );

      expect(currentTotalEpochPremium).to.equal(
        pastTotalEpochPremium.add(premium)
      );

      const currentUserEpochPremium = await ssov.userEpochPremium(
        epoch,
        userStrike
      );

      expect(currentUserEpochPremium).to.equal(
        pastUserEpochPremium.add(premium)
      );
    });

    it('Purchase by user1', async () => {
      const amount = expandTo18Decimals(10);
      const user1Address = await user1.getAddress();
      const epoch = await ssov.currentEpoch();
      const strike = await ssov.epochStrikes(epoch, 1);
      const userStrike = ethers.utils.solidityKeccak256(
        ['address', 'uint256'],
        [user1Address, strike]
      );
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber()
      );
      const expiry = await ssov.getMonthlyExpiryFromTimestamp(block.timestamp);
      const usdPrice = await priceOracleAggregator.viewPriceInUSD(
        dpxToken.address
      );
      const premium = amount
        .mul(
          await optionPricing.getOptionPrice(
            false,
            expiry,
            strike,
            expandToDecimals(100, 8),
            100
          )
        )
        .div(usdPrice);

      const fees = await ssov
        .connect(user0)
        .calculatePurchaseFees(usdPrice, strike, amount);
      const totalPremium = premium.add(fees);
      const feeToDistributor = fees;
      // Epoch Strike Token
      const epochStrikeTokenAddress = await ssov.epochStrikeTokens(
        epoch,
        strike
      );
      const epochStrikeToken = await ethers.getContractAt(
        erc20Abi,
        epochStrikeTokenAddress
      );
      // Past Data
      const pastEpochStrikeTokenBalanceOfVault =
        await epochStrikeToken.balanceOf(ssov.address);
      const pastEpochStrikeTokenBalanceOfUser =
        await epochStrikeToken.balanceOf(user1Address);
      const pastDpxTokenBalanceOfUser = await dpxToken.balanceOf(user1Address);
      const pastTotalEpochCallsPurchased = await ssov.totalEpochCallsPurchased(
        epoch,
        strike
      );
      const pastUserEpochCallsPurchased = await ssov.userEpochCallsPurchased(
        epoch,
        userStrike
      );
      const pastTotalEpochPremium = await ssov.totalEpochPremium(epoch, strike);
      const pastUserEpochPremium = await ssov.userEpochPremium(
        epoch,
        userStrike
      );
      // FeeDistributor balance before exercise
      const feeDistributorBalanceBeforeExercise = await dpxToken.balanceOf(
        await ssov.getAddress(utf8ToHex('FeeDistributor'))
      );
      // Purchase & Event
      await dpxToken.connect(user1).approve(ssov.address, totalPremium);
      await expect(
        ssov.connect(user1).purchase(1, amount, user1.address)
      ).to.emit(ssov, 'NewPurchase');
      // FeeDistributor balance after exercise
      const feeDistributorBalanceAfterExercise = await dpxToken.balanceOf(
        await ssov.getAddress(utf8ToHex('FeeDistributor'))
      );

      // check if fee distributor has received fees
      expect(feeDistributorBalanceAfterExercise).to.be.equal(
        feeDistributorBalanceBeforeExercise.add(feeToDistributor)
      );
      // Current Data
      const currentEpochStrikeTokenBalanceOfVault =
        await epochStrikeToken.balanceOf(ssov.address);
      expect(currentEpochStrikeTokenBalanceOfVault).to.equal(
        pastEpochStrikeTokenBalanceOfVault.sub(amount)
      );
      const currentEpochStrikeTokenBalanceOfUser =
        await epochStrikeToken.balanceOf(user1Address);
      expect(currentEpochStrikeTokenBalanceOfUser).to.equal(
        pastEpochStrikeTokenBalanceOfUser.add(amount)
      );

      const currentDpxTokenBalanceOfUser = await dpxToken.balanceOf(
        user1Address
      );
      expect(currentDpxTokenBalanceOfUser).to.equal(
        pastDpxTokenBalanceOfUser.sub(totalPremium)
      );
      const currentTotalEpochCallsPurchased =
        await ssov.totalEpochCallsPurchased(epoch, strike);
      expect(currentTotalEpochCallsPurchased).to.equal(
        pastTotalEpochCallsPurchased.add(amount)
      );
      const currentUserEpochCallsPurchased = await ssov.userEpochCallsPurchased(
        epoch,
        userStrike
      );
      expect(currentUserEpochCallsPurchased).to.equal(
        pastUserEpochCallsPurchased.add(amount)
      );
      const currentTotalEpochPremium = await ssov.totalEpochPremium(
        epoch,
        strike
      );
      expect(currentTotalEpochPremium).to.equal(
        pastTotalEpochPremium.add(premium)
      );
      const currentUserEpochPremium = await ssov.userEpochPremium(
        epoch,
        userStrike
      );
      expect(currentUserEpochPremium).to.equal(
        pastUserEpochPremium.add(premium).add(fees).sub(feeToDistributor)
      );
    });
  });

  // Settle
  describe('Settle', async () => {
    it('Settle Invalid Strike', async () => {
      timeTravel(
        (await ssov.getEpochTimes(await ssov.currentEpoch())).end.toNumber() +
          60 -
          (await (
            await ethers.provider.getBlock('latest')
          ).timestamp)
      );

      await ssov['expireEpoch()']();

      const epoch = await ssov.currentEpoch();

      await expect(ssov.connect(user0).settle(4, 10, epoch)).to.be.revertedWith(
        'E10'
      );
      await expect(ssov.connect(user0).settle(3, 10, epoch)).to.be.revertedWith(
        'E12'
      );
      await expect(ssov.connect(user0).settle(1, 10, epoch)).to.be.revertedWith(
        'E16'
      );
    });

    it('Settle by user0', async () => {
      const user0Address = await user0.getAddress();
      const epoch = await ssov.currentEpoch();
      const amount = expandTo18Decimals(2);
      const strike = await ssov.epochStrikes(epoch, 0);
      const usdPrice = await priceOracleAggregator.viewPriceInUSD(
        dpxToken.address
      );
      const PnL = amount.mul(usdPrice.sub(strike)).div(usdPrice);

      // Epoch Strike Token
      const epochStrikeTokenAddress = await ssov.epochStrikeTokens(
        epoch,
        strike
      );
      const epochStrikeToken = await ethers.getContractAt(
        erc20Abi,
        epochStrikeTokenAddress
      );

      // Past Data
      const pastEpochStrikeTokenBalanceOfUser =
        await epochStrikeToken.balanceOf(user0Address);
      const pastEpochStrikeTokenTotalSupply =
        await epochStrikeToken.totalSupply();

      const pastDpxTokenBalanceOfUser = await dpxToken.balanceOf(user0Address);

      // Exercise
      await epochStrikeToken.connect(user0).approve(ssov.address, amount);

      await expect(ssov.connect(user0).settle(0, amount, epoch)).to.emit(
        ssov,
        'NewSettle'
      );

      // Current Data
      const currentEpochStrikeTokenBalanceOfUser =
        await epochStrikeToken.balanceOf(user0Address);

      expect(currentEpochStrikeTokenBalanceOfUser).to.equal(
        pastEpochStrikeTokenBalanceOfUser.sub(amount)
      );

      const currentEpochStrikeTokenTotalSupply =
        await epochStrikeToken.totalSupply();

      expect(currentEpochStrikeTokenTotalSupply).to.equal(
        pastEpochStrikeTokenTotalSupply.sub(amount)
      );

      const currentDpxTokenBalanceOfUser = await dpxToken.balanceOf(
        user0Address
      );

      expect(currentDpxTokenBalanceOfUser).to.equal(
        pastDpxTokenBalanceOfUser.add(PnL)
      );
    });

    it('Settle by user1', async () => {
      const epoch = await ssov.currentEpoch();

      await expect(ssov.connect(user1).settle(0, 1, epoch)).to.be.revertedWith(
        'E16'
      );
    });
  });

  describe('Withdraw For Strike', async () => {
    it('should not withdraw for a 0 amount', async () => {
      const epoch = await ssov.currentEpoch();

      await expect(ssov.connect(user0).withdraw(epoch, 0)).to.be.revertedWith(
        'E18'
      );
    });

    it('withdraw for invalid strike invalid Strike', async () => {
      const epoch = await ssov.currentEpoch();

      // Assert valid strike
      await expect(ssov.connect(user0).withdraw(epoch, 3)).to.be.revertedWith(
        'E12'
      );

      // Assert valid strike index
      await expect(ssov.connect(user0).withdraw(epoch, 5)).to.be.revertedWith(
        'E10'
      );
    });

    it('withdraw by user0', async () => {
      const user0Address = await user0.getAddress();
      const epoch = (await ssov.currentEpoch()).sub(1);
      const strike = await ssov.epochStrikes(epoch, 0);
      const userStrike = ethers.utils.solidityKeccak256(
        ['address', 'uint256'],
        [user0Address, strike]
      );

      // Past Data
      const pastUserStrikeDeposits = await ssov.userEpochDeposits(
        epoch,
        userStrike
      );
      const pastTotalEpochStrikeDeposits = await ssov.totalEpochStrikeDeposits(
        epoch,
        strike
      );

      const pastDpxTokenBalanceOfUser = await dpxToken.balanceOf(user0Address);

      const pastDpxTokenBalanceOfVault = await dpxToken.balanceOf(ssov.address);

      const pastTotalEpochRdpxBalance = await ssov.totalEpochStrikeRdpxBalance(
        epoch,
        strike
      );

      const pastTotalEpochDpxBalance = await ssov.totalEpochStrikeDpxBalance(
        epoch,
        strike
      );

      const pastRdpxTokenBalanceOfUser = await rdpxToken.balanceOf(
        user0Address
      );
      const pastRdpxTokenBalanceOfVault = await rdpxToken.balanceOf(
        ssov.address
      );

      const userRdpxAmount = pastTotalEpochRdpxBalance
        .mul(pastUserStrikeDeposits)
        .div(pastTotalEpochStrikeDeposits);

      const userDpxAmount = pastTotalEpochDpxBalance
        .mul(pastUserStrikeDeposits)
        .div(pastTotalEpochStrikeDeposits);

      await expect(ssov.connect(user0).withdraw(epoch, 0)).to.emit(
        ssov,
        'NewWithdraw'
      );

      // Current Data
      const currentUserStrikeDeposits = await ssov.userEpochDeposits(
        epoch,
        userStrike
      );
      expect(currentUserStrikeDeposits).to.equal(0);

      const currentDpxTokenBalanceOfUser = await dpxToken.balanceOf(
        user0Address
      );

      expect(currentDpxTokenBalanceOfUser).to.equal(
        pastDpxTokenBalanceOfUser.add(userDpxAmount)
      );

      const currentDpxTokenBalanceOfVault = await dpxToken.balanceOf(
        ssov.address
      );
      expect(currentDpxTokenBalanceOfVault).to.equal(
        pastDpxTokenBalanceOfVault.sub(userDpxAmount)
      );

      const currentRdpxTokenBalanceOfUser = await rdpxToken.balanceOf(
        user0Address
      );
      expect(currentRdpxTokenBalanceOfUser).to.equal(
        pastRdpxTokenBalanceOfUser.add(userRdpxAmount)
      );

      const currentRdpxTokenBalanceOfVault = await rdpxToken.balanceOf(
        ssov.address
      );
      expect(currentRdpxTokenBalanceOfVault).to.equal(
        pastRdpxTokenBalanceOfVault.sub(userRdpxAmount)
      );
    });

    it('revert if tried to withdraw with no deposits in the vault', async () => {
      const epoch = (await ssov.currentEpoch()).sub(1);

      await expect(ssov.connect(owner).withdraw(epoch, 1)).to.be.revertedWith(
        'E18'
      );
    });
  });

  describe('Setting Addresses', async () => {
    it('should revert if sender is not owner', async () => {
      const inputs = [[ethers.utils.id('owner')], [await owner.getAddress()]];

      await expect(
        ssov.connect(user0).setAddresses(inputs[0], inputs[1])
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
    it('should set address using owner as example', async () => {
      const inputs = [[ethers.utils.id('owner')], [await owner.getAddress()]];

      expect(
        await ssov.connect(owner).setAddresses(inputs[0], inputs[1])
      ).to.emit(ssov, 'AddressSet');
    });
  });

  describe('Fee calculation', async () => {
    it('should return the correct fee', async () => {
      // Buy 1000 options, total premium is 100 DPX
      const fees = await ssov.calculatePurchaseFees(
        expandToDecimals(4000, 8),
        expandToDecimals(8000, 8),
        expandTo18Decimals(1000)
      );

      // Final fee should be 0.125% * 2 of 1000 DPX (1e18)
      expect(fees.toString()).to.equal('2500000000000000000');
    });
  });
});
