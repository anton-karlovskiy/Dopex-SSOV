import { expect } from "chai";
import { Contract, Signer } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";

import {
  deployPriceOracleAggregator,
  deployMockDPXChainlinkUSDAdapter,
  deployMockOptionPricing,
  deployVault
} from "../helper/contract";
import { timeTravel, expandTo18Decimals, unlockAccount } from "../helper/util";
import { dpxHolders, dpx, dpxTokenAbi, rdpx, rdpxTokenAbi, stakingRewards } from "../helper/data";
import { Vault, MockOptionPricing } from '../types';

describe("Vault test", async () => {
  let signers: SignerWithAddress[];
  let owner: SignerWithAddress;
  let user0: Signer;
  let user1: Signer;
  let user2: Signer;
  let dpxToken: Contract;
  let rdpxToken: Contract;
  let optionPricing: MockOptionPricing;
  let vault: Vault;
  let strikes = [80, 120, 150, 0];

  // Contract Setup
  before(async () => {
    signers = await ethers.getSigners();
    owner = signers[0];

    // Users
    await unlockAccount(dpxHolders[0]);
    await signers[1].sendTransaction({ to: dpxHolders[0], value: expandTo18Decimals(500)});
    user0 = await ethers.provider.getSigner(dpxHolders[0]);

    await unlockAccount(dpxHolders[1]);
    await signers[2].sendTransaction({ to: dpxHolders[1], value: expandTo18Decimals(500)});
    user1 = await ethers.provider.getSigner(dpxHolders[1]);

    await unlockAccount(dpxHolders[2]);
    await signers[3].sendTransaction({ to: dpxHolders[2], value: expandTo18Decimals(500)});
    user2 = await ethers.provider.getSigner(dpxHolders[2]);

    // DpxToken
    dpxToken = await ethers.getContractAt(dpxTokenAbi, dpx);

    // RdpxToken
    rdpxToken = await ethers.getContractAt(rdpxTokenAbi, rdpx);

    // Chainlink Price Aggregator
    const priceOracleAggregator = await deployPriceOracleAggregator(
        owner.address
    );

    // Mock DPX Chainlink USD Adapter
    const mockERC20ChainlinkUSDAdapter = await deployMockDPXChainlinkUSDAdapter();
    await priceOracleAggregator.updateOracleForAsset(
        dpx,
        mockERC20ChainlinkUSDAdapter.address
    );
    await priceOracleAggregator.getPriceInUSD(dpx);

    // Mock Option Pricing
    optionPricing = await deployMockOptionPricing();

    // Vault
    vault = await deployVault(dpx, rdpx, stakingRewards, optionPricing.address, priceOracleAggregator.address);
  });

  // Contract Info
  describe("Vault Contract Info", async () => {

      // DPX/RDPX/StakingRewards
      it("DPX/RDPX/StakingRewards Address", async () => {
        expect((await vault.dpx()).toString().toLowerCase()).to.equal(dpx);
        expect((await vault.rdpx()).toString().toLowerCase()).to.equal(rdpx);
        expect((await vault.stakingRewards()).toString().toLowerCase()).to.equal(stakingRewards);
      });

      // DPX token price = 100$
      it("DPX token price is 100 USD", async () => {
          expect((await vault.viewUsdPrice(dpx)).toNumber()).to.equal(100 * 10 ** 8);
      })
  });

  // Strikes
  describe("Vault Strikes", async () => {

    // Set Strikes OnlyOwner
    it("Set Strikes OnlyOnwer", async () => {
        await expect(vault.connect(user0).setStrikes([120])).to.be.revertedWith("Ownable: caller is not the owner");
    })

    // Set Strikes
    it("Set Strikes Success", async () => {
        await vault.connect(owner).setStrikes(strikes);

        expect((await vault.epochStrikes(1, 0)).toNumber()).to.equal(strikes[0]);
        expect((await vault.epochStrikes(1, 1)).toNumber()).to.equal(strikes[1]);
        expect((await vault.epochStrikes(1, 2)).toNumber()).to.equal(strikes[2]);
    })
  });

  // Deposit Single/Multiple
  describe("Deposit Single/Multiple", async () => {

    // Deposit with wrong strike
    it("Deposit with wrong strike", async () => {
        await expect(vault.connect(user0).deposit(3, 100)).to.be.revertedWith("Invalid strike");
        await expect(vault.connect(user0).deposit(4, 100)).to.
        be.revertedWith("Invalid strike index")
    });

    // Deposit single
    it("Deposit single & userEpochDeposits/totalEpochStrikeDeposits/totalEpochDeposits", async () => {
        const amount0 = expandTo18Decimals(10);
        const user0Address = await user0.getAddress();
        const epoch = (await vault.epoch()).add(1);
        const strike = await vault.epochStrikes(epoch, 0);
        const userStrike = ethers.utils.solidityKeccak256(["address", "uint256"], [user0Address, strike]);

        // Past Data
        const pastBalance = await dpxToken.balanceOf(user0Address);
        const pastUserEpochDeposits = await vault.userEpochDeposits(epoch, userStrike);
        const pastTotalEpochStrikeDeposits = await vault.totalEpochStrikeDeposits(epoch, strike);
        const pastTotalEpochDeposits = await vault.totalEpochDeposits(epoch);

        // Approve
        await dpxToken.connect(user0).approve(vault.address, amount0);

        // Deposit & Event
        await expect(vault.connect(user0).deposit(0, amount0)).to.emit(vault, "LogNewDeposit");

        // Current Data
        const currentBalance = await dpxToken.balanceOf(user0Address);
        expect(currentBalance).to.equal(pastBalance.sub(amount0));

        const currentUserEpochDeposits = await vault.userEpochDeposits(epoch, userStrike);
        expect(currentUserEpochDeposits).to.equal(pastUserEpochDeposits.add(amount0));

        const currentTotalEpochStrikeDeposits = await vault.totalEpochStrikeDeposits(epoch, strike);
        expect(currentTotalEpochStrikeDeposits).to.equal(pastTotalEpochStrikeDeposits.add(amount0));

        const currentTotalEpochDeposits = await vault.totalEpochDeposits(epoch);
        expect(currentTotalEpochDeposits).to.equal(pastTotalEpochDeposits.add(amount0));

    });

    // Deposit multiple
    it("Deposit multiple", async () => {
        const amount0 = expandTo18Decimals(15);
        const amount1 = expandTo18Decimals(25);
        const pastBalance = await dpxToken.balanceOf(await user1.getAddress());

        // Approve
        await dpxToken.connect(user1).approve(vault.address, amount0.add(amount1));

        // Deposit
        await vault.connect(user1).depositMultiple([1, 2], [amount0, amount1]);

        // Balance
        const currentBalance = await dpxToken.balanceOf(await user1.getAddress());
        expect(currentBalance).to.equal(pastBalance.sub(amount0.add(amount1)));
    });
  });

  // Bootstrap
  describe("Bootstrap", async () => {

    // Bootstrap OnlyOwner
    it("Bootstrap OnlyOwner", async () => {
        await expect(vault.connect(user0).bootstrap()).to.be.revertedWith("Ownable: caller is not the owner");
    })

    // Bootstrap EpochStrikeTokens
    it("Bootstrap EpochStrikeTokens name/symbol/amount", async () => {
        const pastEpoch = await vault.epoch();
        await vault.connect(owner).bootstrap();
        const currentEpoch = await vault.epoch();
        expect(currentEpoch).to.equal(pastEpoch.add(1));
        for (let i = 0; i < 3; i++) {
            const epochStrikeTokenAddress = await vault.epochStrikeTokens(currentEpoch, strikes[i]);
            const epochStrikeToken = await ethers.getContractAt(dpxTokenAbi, epochStrikeTokenAddress);
            expect(await epochStrikeToken.name()).to.equal(`DPX-CALL${strikes[i]}-EPOCH-${currentEpoch}`)
            expect(await epochStrikeToken.symbol()).to.equal(`DPX-CALL${strikes[i]}-EPOCH-${currentEpoch}`)
            expect(await epochStrikeToken.balanceOf(vault.address)).to.equal(await vault.totalEpochStrikeDeposits(currentEpoch, strikes[i]))
        }
    })
  });

  // Purchase
  describe("Purchase", async () => {
      
    // Purhcase Invalid Strike
    it("Purhcase Invalid Strike", async () => {
        await expect(vault.connect(user0).purchase(4, 10)).to.be.revertedWith("Invalid strike index");
        await expect(vault.connect(user0).purchase(3, 10)).to.be.revertedWith("Invalid strike");
    });

    // Purchase un-bootstrapped epoch
    it("Purchase un-bootstrapped epoch", async () => {
        timeTravel(24 * 60 * 60 * 30);
        
        // Set Strikes
        await vault.connect(owner).setStrikes(strikes);
        
        // Deposit
        const amount0 = expandTo18Decimals(10);
        await dpxToken.connect(user0).approve(vault.address, amount0);
        await vault.connect(user0).deposit(0, amount0);

        // Purchase before bootstrap
        await expect(vault.connect(user0).purchase(0, amount0)).to.be.revertedWith("Epoch hasn't been bootstrapped");

        timeTravel(-24 * 60 * 60 * 30);
    })

    // Purchase exceeds the deposit amount
    it("Purhcase exceeds the deposit amount", async () => {
        await expect(vault.connect(user0).purchase(0, expandTo18Decimals(20))).to.be.revertedWith("User didn't deposit enough for purchase");
    })

    // Purchase
    it("Purchase by user0", async () => {
        const amount = expandTo18Decimals(5);
        const user0Address = await user0.getAddress();
        const epoch = await vault.epoch();
        const strike = await vault.epochStrikes(epoch, 0);
        const userStrike = ethers.utils.solidityKeccak256(["address", "uint256"], [user0Address, strike]);
        const block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
        const expiry = await vault.getMonthlyExpiryFromTimestamp(block.timestamp);
        const usdPrice = await vault.viewUsdPrice(dpxToken.address);
        const premium = amount.mul(await optionPricing.getOptionPrice(false, expiry, strike)).div(usdPrice);

        // Epoch Strike Token
        const epochStrikeTokenAddress = await vault.epochStrikeTokens(epoch, strike);
        const epochStrikeToken = await ethers.getContractAt(dpxTokenAbi, epochStrikeTokenAddress);

        // Past Data
        const pastEpochStrikeTokenBalanceOfVault = await epochStrikeToken.balanceOf(vault.address);
        const pastEpochStrikeTokenBalanceOfUser = await epochStrikeToken.balanceOf(user0Address);
        const pastDpxTokenBalanceOfVault = await dpxToken.balanceOf(vault.address);
        const pastDpxTokenBalanceOfUser = await dpxToken.balanceOf(user0Address);
        const pastTotalEpochCallsPurchased = await vault.totalEpochCallsPurchased(epoch, strike);
        const pastUserEpochCallsPurchased = await vault.userEpochCallsPurchased(epoch, userStrike);
        const pastTotalEpochPremium = await vault.totalEpochPremium(epoch, strike);
        const pastUserEpochPremium = await vault.userEpochPremium(epoch, userStrike);
        
        // Purchase & Event
        await dpxToken.connect(user0).approve(vault.address, premium);
        await expect(vault.connect(user0).purchase(0, amount)).to.emit(vault, "LogNewPurchase");

        // Current Data
        const currentEpochStrikeTokenBalanceOfVault = await epochStrikeToken.balanceOf(vault.address);
        expect(currentEpochStrikeTokenBalanceOfVault).to.equal(pastEpochStrikeTokenBalanceOfVault.sub(amount));
        const currentEpochStrikeTokenBalanceOfUser = await epochStrikeToken.balanceOf(user0Address);
        expect(currentEpochStrikeTokenBalanceOfUser).to.equal(pastEpochStrikeTokenBalanceOfUser.add(amount));
        const currentDpxTokenBalanceOfVault = await dpxToken.balanceOf(vault.address);
        expect(currentDpxTokenBalanceOfVault).to.equal(pastDpxTokenBalanceOfVault.add(premium));
        const currentDpxTokenBalanceOfUser = await dpxToken.balanceOf(user0Address);
        expect(currentDpxTokenBalanceOfUser).to.equal(pastDpxTokenBalanceOfUser.sub(premium));
        const currentTotalEpochCallsPurchased = await vault.totalEpochCallsPurchased(epoch, strike);
        expect(currentTotalEpochCallsPurchased).to.equal(pastTotalEpochCallsPurchased.add(amount));
        const currentUserEpochCallsPurchased = await vault.userEpochCallsPurchased(epoch, userStrike);
        expect(currentUserEpochCallsPurchased).to.equal(pastUserEpochCallsPurchased.add(amount));
        const currentTotalEpochPremium = await vault.totalEpochPremium(epoch, strike);
        expect(currentTotalEpochPremium).to.equal(pastTotalEpochPremium.add(premium));
        const currentUserEpochPremium = await vault.userEpochPremium(epoch, userStrike);
        expect(currentUserEpochPremium).to.equal(pastUserEpochPremium.add(premium));
    })

    it("Purchase by user1", async () => {
        const amount = expandTo18Decimals(10);
        const user1Address = await user1.getAddress();
        const epoch = await vault.epoch();
        const strike = await vault.epochStrikes(epoch, 1);
        const userStrike = ethers.utils.solidityKeccak256(["address", "uint256"], [user1Address, strike]);
        const block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
        const expiry = await vault.getMonthlyExpiryFromTimestamp(block.timestamp);
        const usdPrice = await vault.viewUsdPrice(dpxToken.address);
        const premium = amount.mul(await optionPricing.getOptionPrice(false, expiry, strike)).div(usdPrice);

        // Epoch Strike Token
        const epochStrikeTokenAddress = await vault.epochStrikeTokens(epoch, strike);
        const epochStrikeToken = await ethers.getContractAt(dpxTokenAbi, epochStrikeTokenAddress);

        // Past Data
        const pastEpochStrikeTokenBalanceOfVault = await epochStrikeToken.balanceOf(vault.address);
        const pastEpochStrikeTokenBalanceOfUser = await epochStrikeToken.balanceOf(user1Address);
        const pastDpxTokenBalanceOfVault = await dpxToken.balanceOf(vault.address);
        const pastDpxTokenBalanceOfUser = await dpxToken.balanceOf(user1Address);
        const pastTotalEpochCallsPurchased = await vault.totalEpochCallsPurchased(epoch, strike);
        const pastUserEpochCallsPurchased = await vault.userEpochCallsPurchased(epoch, userStrike);
        const pastTotalEpochPremium = await vault.totalEpochPremium(epoch, strike);
        const pastUserEpochPremium = await vault.userEpochPremium(epoch, userStrike);
        
        // Purchase & Event
        await dpxToken.connect(user1).approve(vault.address, premium);
        await expect(vault.connect(user1).purchase(1, amount)).to.emit(vault, "LogNewPurchase");

        // Current Data
        const currentEpochStrikeTokenBalanceOfVault = await epochStrikeToken.balanceOf(vault.address);
        expect(currentEpochStrikeTokenBalanceOfVault).to.equal(pastEpochStrikeTokenBalanceOfVault.sub(amount));
        const currentEpochStrikeTokenBalanceOfUser = await epochStrikeToken.balanceOf(user1Address);
        expect(currentEpochStrikeTokenBalanceOfUser).to.equal(pastEpochStrikeTokenBalanceOfUser.add(amount));
        const currentDpxTokenBalanceOfVault = await dpxToken.balanceOf(vault.address);
        expect(currentDpxTokenBalanceOfVault).to.equal(pastDpxTokenBalanceOfVault.add(premium));
        const currentDpxTokenBalanceOfUser = await dpxToken.balanceOf(user1Address);
        expect(currentDpxTokenBalanceOfUser).to.equal(pastDpxTokenBalanceOfUser.sub(premium));
        const currentTotalEpochCallsPurchased = await vault.totalEpochCallsPurchased(epoch, strike);
        expect(currentTotalEpochCallsPurchased).to.equal(pastTotalEpochCallsPurchased.add(amount));
        const currentUserEpochCallsPurchased = await vault.userEpochCallsPurchased(epoch, userStrike);
        expect(currentUserEpochCallsPurchased).to.equal(pastUserEpochCallsPurchased.add(amount));
        const currentTotalEpochPremium = await vault.totalEpochPremium(epoch, strike);
        expect(currentTotalEpochPremium).to.equal(pastTotalEpochPremium.add(premium));
        const currentUserEpochPremium = await vault.userEpochPremium(epoch, userStrike);
        expect(currentUserEpochPremium).to.equal(pastUserEpochPremium.add(premium));
    })
  })
});