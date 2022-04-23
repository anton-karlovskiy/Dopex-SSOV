import { ethers, BigNumber } from 'ethers';
import hre, { network } from 'hardhat';

export const expandTo18Decimals = (n: string | number): BigNumber => {
  return ethers.utils.parseEther(String(n));
};

export const expandToDecimals = (n: number | string, d: number): BigNumber =>
  ethers.utils.parseUnits(String(n), d);

export const buildBytecode = (
  constructorTypes: any[],
  constructorArgs: any[],
  contractBytecode: string
) =>
  `${contractBytecode}${encodeParams(constructorTypes, constructorArgs).slice(
    2
  )}`;

export const buildCreate2Address = (
  address: string,
  saltHex: string,
  byteCode: string
) => {
  return `0x${ethers.utils
    .keccak256(
      `0x${['ff', address, saltHex, ethers.utils.keccak256(byteCode)]
        .map((x) => x.replace(/0x/, ''))
        .join('')}`
    )
    .slice(-40)}`.toLowerCase();
};

export const numberToUint256 = (value: number) => {
  const hex = value.toString(16);
  return `0x${'0'.repeat(64 - hex.length)}${hex}`;
};

export const saltToHex = (salt: string | number) =>
  ethers.utils.id(salt.toString());

export const encodeParam = (dataType: any, data: any) => {
  const abiCoder = ethers.utils.defaultAbiCoder;
  return abiCoder.encode([dataType], [data]);
};

export const encodeParams = (dataTypes: any[], data: any[]) => {
  const abiCoder = ethers.utils.defaultAbiCoder;
  return abiCoder.encode(dataTypes, data);
};

export const timeTravel = async (seconds: number) => {
  await network.provider.send('evm_increaseTime', [seconds]);
  await network.provider.send('evm_mine', []);
};

export const unlockAccount = async (address: string) => {
  await hre.network.provider.send('hardhat_impersonateAccount', [address]);
  return address;
};

export const waitSeconds = (sec: number) =>
  new Promise((resolve) => setTimeout(resolve, sec * 1000));

export const forkNetwork = async (
  jsonRpcUrl: string,
  block: number
): Promise<any> => {
  return await network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl,
          block,
        },
      },
    ],
  });
};

export const forkBsc = async () => {
  if (!process.env.BSC_NET_API_URL) {
    throw new Error('Please set BSC_NET_API_URL');
  }
  await forkNetwork(process.env.BSC_NET_API_URL, 14141714);
};

export const forkArbitrum = async () => {
  if (!process.env.ARBITRUM_NET_API_URL) {
    throw new Error('Please set ARBITRUM_NET_API_URL');
  }
  await forkNetwork(process.env.ARBITRUM_NET_API_URL, 4708000);
};
