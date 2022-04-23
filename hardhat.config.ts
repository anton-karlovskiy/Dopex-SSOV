import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';
import '@typechain/hardhat';
import 'hardhat-contract-sizer';
import 'hardhat-deploy';
import 'hardhat-gas-reporter';
import 'solidity-coverage';

import dotenv from 'dotenv';

dotenv.config();

export default {
  solidity: {
    compilers: [
      {
        version: '0.8.9',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.6.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  namedAccounts: {
    deployer: 0,
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
  },
  typechain: {
    outDir: 'types/',
    target: 'ethers-v5',
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.MAIN_NET_API_URL,
        blockNumber: 13602000,
      },
      hardfork: 'london',
      gasPrice: 'auto',
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
    },
    ...(process.env.KOVAN_NET_API_URL &&
      process.env.KOVAN_MNEMONIC && {
        kovan: {
          url: process.env.KOVAN_NET_API_URL,
          accounts: { mnemonic: process.env.KOVAN_MNEMONIC },
        },
      }),
    ...(process.env.ARBITRUM_RINKEBY_NET_API_URL &&
      process.env.ARBITRUM_RINKEBY_MNEMONIC && {
        'arbitrum-rinkeby': {
          url: process.env.ARBITRUM_RINKEBY_NET_API_URL,
          accounts: { mnemonic: process.env.ARBITRUM_RINKEBY_MNEMONIC },
        },
      }),
    ...(process.env.ARBITRUM_NET_API_URL && {
      arbitrum: {
        url: process.env.ARBITRUM_NET_API_URL,
        accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      },
    }),
    ...(process.env.BSC_NET_API_URL && {
      bsc: {
        url: process.env.BSC_NET_API_URL,
        accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      },
    }),
    ...(process.env.MAINNET_NET_API_URL && {
      mainnet: {
        url: process.env.MAINNET_NET_API_URL,
        accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
        gasPrice: 140000000000,
      },
    }),
  },
  paths: {
    deploy: 'deploy',
    deployments: 'deployments',
    imports: 'imports',
  },
  mocha: {
    timeout: 200000,
  },
  ...(process.env.ETHERSCAN_API_KEY && {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
  }),
};
