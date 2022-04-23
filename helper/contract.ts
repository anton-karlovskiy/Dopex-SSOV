import hre from 'hardhat';
import { Contract, Signer } from 'ethers';

import { expandTo18Decimals } from './utils';

import {
  PriceOracleAggregator,
  ChainlinkUSDAdapter,
  UniswapV2Oracle,
  MockDPXChainlinkUSDAdapter,
  MockOptionPricing,
  MainnetEthSSOV,
  StakingRewardsFactory,
  StakingRewards__factory,
  StakingRewardsV2,
  DpxToken,
  RdpxToken,
  BnbSSOV,
  MockChainlinkAggregator,
  ArbEthSSOVV2,
  GohmSSOVV2,
  RdpxSSOVV2,
  DpxSSOVV2,
  GmxSSOV,
} from '../types';

export const deployContract = async <ContractType extends Contract>(
  contractName: string,
  args: any[]
) => {
  const signers = await hre.ethers.getSigners();
  const contract = (await (
    await hre.ethers.getContractFactory(contractName, signers[0])
  ).deploy(...args)) as ContractType;

  return contract;
};

export const deployPriceOracleAggregator = async () => {
  return await deployContract<PriceOracleAggregator>(
    'PriceOracleAggregator',
    []
  );
};

export const deployChainlinkUSDAdapter = async (
  asset: string,
  aggregator: string
) => {
  return await deployContract<ChainlinkUSDAdapter>('ChainlinkUSDAdapter', [
    asset,
    aggregator,
  ]);
};

export const deployUniswapV2Oracle = async (
  factory: string,
  tokenA: string,
  tokenB: string,
  aggregator: string
) => {
  return await deployContract<UniswapV2Oracle>('UniswapV2Oracle', [
    factory,
    tokenA,
    tokenB,
    aggregator,
  ]);
};

export const deployMockDPXChainlinkUSDAdapter = async () => {
  return await deployContract<MockDPXChainlinkUSDAdapter>(
    'MockDPXChainlinkUSDAdapter',
    []
  );
};

export const deployMockChainlinkAggregator = async () => {
  return await deployContract<MockChainlinkAggregator>(
    'MockChainlinkAggregator',
    []
  );
};

export const deployMockOptionPricing = async () => {
  return await deployContract<MockOptionPricing>('MockOptionPricing', []);
};

export const deploySSOV = async (
  dpx: string,
  rdpx: string,
  stakingRewards: string,
  optionPricing: string,
  priceOracleAggregator: string,
  volatilityOracleAddress: string,
  feeDistributor: string,
  feeStrategy: string
) => {
  return await deployContract<DpxSSOVV2>('DpxSSOVV2', [
    dpx,
    rdpx,
    stakingRewards,
    optionPricing,
    priceOracleAggregator,
    volatilityOracleAddress,
    feeDistributor,
    feeStrategy,
  ]);
};

export const deployMainnetEthSSOV = async (
  weth: string,
  stEth: string,
  curve: string,
  yearn: string,
  optionPricing: string,
  priceOracleAggregator: string,
  volatilityOracleAddress: string,
  feeDistributor: string
) => {
  return await deployContract<MainnetEthSSOV>('MainnetEthSSOV', [
    weth,
    stEth,
    curve,
    yearn,
    optionPricing,
    priceOracleAggregator,
    volatilityOracleAddress,
    feeDistributor,
  ]);
};

export const deployBnbSSOV = async (
  vbnb: string,
  optionPricing: string,
  priceOracleAggregator: string,
  volatilityOracleAddress: string,
  feeDistributor: string,
  feeStrategy: string
) => {
  return await deployContract<BnbSSOV>('BnbSSOV', [
    vbnb,
    optionPricing,
    priceOracleAggregator,
    volatilityOracleAddress,
    feeDistributor,
    feeStrategy,
  ]);
};

export const deployEthSSOV = async (
  rewardsDistribution: string,
  optionPricing: string,
  chainlinkAggregator: string,
  volatilityOracleAddress: string,
  feeDistributor: string,
  feeStrategy: string
) => {
  return deployContract<ArbEthSSOVV2>('ArbEthSSOVV2', [
    rewardsDistribution,
    optionPricing,
    chainlinkAggregator,
    volatilityOracleAddress,
    feeDistributor,
    feeStrategy,
  ]);
};

export const deployRdpxSSOV = async (
  dpx: string,
  rdpx: string,
  stakingRewards: string,
  optionPricing: string,
  priceOracleAggregator: string,
  volatilityOracleAddress: string,
  feeDistributor: string,
  feeStrategy: string
) => {
  return await deployContract<RdpxSSOVV2>('RdpxSSOVV2', [
    dpx,
    rdpx,
    stakingRewards,
    optionPricing,
    priceOracleAggregator,
    volatilityOracleAddress,
    feeDistributor,
    feeStrategy,
  ]);
};

export const deployGohmSSOV = async (
  gohm: string,
  optionPricing: string,
  gohmPriceOracle: string,
  volatilityOracleAddress: string,
  feeDistributor: string,
  feeStrategy: string
) => {
  return await deployContract<GohmSSOVV2>('GohmSSOVV2', [
    gohm,
    optionPricing,
    gohmPriceOracle,
    volatilityOracleAddress,
    feeDistributor,
    feeStrategy,
  ]);
};

export const deployGmxSSOV = async (
  sources: string[],
  destinations: string[]
) => {
  return await deployContract<GmxSSOV>('GmxSSOV', [sources, destinations]);
};

export const deployStakingRewards = async (
  genesis: number,
  dpxAddress: string,
  rdpxAddress: string,
  signer: Signer
) => {
  // Create staking rewards factory with DPX rewards
  const stakingRewardsFactory = await deployContract<StakingRewardsFactory>(
    'StakingRewardsFactory',
    [dpxAddress, rdpxAddress, genesis]
  );

  await stakingRewardsFactory.deploy(
    dpxAddress,
    expandTo18Decimals(1000), // 1k dpx rewards
    expandTo18Decimals(500000), // 500k rdpx rewards
    86400 * 365, // 365 days staking rewards period
    1, // no boosted period
    1, // boost
    1 // DPX pool ID
  );

  const stakingRewardsAddress = (
    await stakingRewardsFactory.stakingRewardsInfoByStakingToken(1)
  ).stakingRewards;

  return {
    stakingRewards: StakingRewards__factory.connect(
      stakingRewardsAddress,
      signer
    ),
    stakingRewardsFactory,
  };
};

export const deployRdpxStakingRewards = async (
  dpxAddress: string,
  rdpxAddress: string
) => {
  // Create staking rewards with DPX rewards
  const stakingRewards = await deployContract<StakingRewardsV2>(
    'StakingRewardsV2',
    [
      dpxAddress,
      rdpxAddress,
      rdpxAddress,
      86400 * 7 * 52, // 52 weeks
      86400 * 7 * 4, //  4 weeks boosted time
      2, // Boost
    ]
  );

  return {
    stakingRewards,
  };
};

export const deployTokens = async () => {
  return {
    dpxToken: await deployContract<DpxToken>('DpxToken', []),
    rdpxToken: await deployContract<RdpxToken>('RdpxToken', []),
  };
};
