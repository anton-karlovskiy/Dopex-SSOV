//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

/**                                                                                                 
          █████╗ ████████╗██╗      █████╗ ███╗   ██╗████████╗██╗ ██████╗
          ██╔══██╗╚══██╔══╝██║     ██╔══██╗████╗  ██║╚══██╔══╝██║██╔════╝
          ███████║   ██║   ██║     ███████║██╔██╗ ██║   ██║   ██║██║     
          ██╔══██║   ██║   ██║     ██╔══██║██║╚██╗██║   ██║   ██║██║     
          ██║  ██║   ██║   ███████╗██║  ██║██║ ╚████║   ██║   ██║╚██████╗
          ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝ ╚═════╝
                                                                        
          ██████╗ ██████╗ ████████╗██╗ ██████╗ ███╗   ██╗███████╗       
          ██╔═══██╗██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║██╔════╝       
          ██║   ██║██████╔╝   ██║   ██║██║   ██║██╔██╗ ██║███████╗       
          ██║   ██║██╔═══╝    ██║   ██║██║   ██║██║╚██╗██║╚════██║       
          ╚██████╔╝██║        ██║   ██║╚██████╔╝██║ ╚████║███████║       
          ╚═════╝ ╚═╝        ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝       
                                                               
                            Atlantic Options
              Yield bearing put options with mobile collateral                                                           
*/

// Libraries
import {Strings} from '@openzeppelin/contracts/utils/Strings.sol';
import {Clones} from '@openzeppelin/contracts/proxy/Clones.sol';
import {BokkyPooBahsDateTimeLibrary} from '../external/libraries/BokkyPooBahsDateTimeLibrary.sol';
import {SafeERC20} from '../external/libraries/SafeERC20.sol';

// Contracts
import {ReentrancyGuard} from '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import {ERC20PresetMinterPauserUpgradeable} from '@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol';
import {Pausable} from '@openzeppelin/contracts/security/Pausable.sol';
import {ContractWhitelist} from '../helper/ContractWhitelist.sol';

// Interfaces
import {IERC20} from '../external/interfaces/IERC20.sol';
import {IChainlinkV3Aggregator} from '../external/interfaces/IChainlinkV3Aggregator.sol';
import {IETHVolatilityOracle} from '../interfaces/IETHVolatilityOracle.sol';
import {IOptionPricing} from '../interfaces/IOptionPricing.sol';

contract AtlanticPool is Pausable, ReentrancyGuard {
    using BokkyPooBahsDateTimeLibrary for uint256;
    using Strings for uint256;
    using SafeERC20 for IERC20;

    /// @dev ERC20PresetMinterPauserUpgradeable implementation address
    address public immutable erc20Implementation;

    /// @dev Current epoch for ssov
    uint256 public currentEpoch;

    /// @dev Exercise Window Size
    uint256 public windowSize = 1 hours;

    /// @dev Purchase Fee: x% of the price of the underlying asset * the amount of options being bought * OTM Fee Multiplier
    uint256 public purchaseFeePercentage = 125e8 / 1000; // 0.125%

    /// @dev Expire delay tolerance
    uint256 public expireDelayTolerance = 5 minutes;

    /// @dev Quote token address for this AP-Pool
    address public quote;

    /// @dev Base token address for this instance of SSOV-P
    address public base;

    /// @dev The list of contract addresses the contract uses
    mapping(bytes32 => address) public addresses;

    /// @dev epoch => the epoch start time
    mapping(uint256 => uint256) public epochStartTimes;

    /// @notice Is epoch expired
    /// @dev epoch => whether the epoch is expired
    mapping(uint256 => bool) public isEpochExpired;

    /// @notice Is vault ready for next epoch
    /// @dev epoch => whether the vault is ready (boostrapped)
    mapping(uint256 => bool) public isVaultReady;

    /// @dev Mapping of strikes for each epoch
    mapping(uint256 => uint256[]) public epochStrikes;

    /// @dev Mapping of (epoch => (strike => tokens))
    mapping(uint256 => mapping(uint256 => address)) public epochStrikeTokens;

    /// @notice Total epoch deposits for specific strikes
    /// @dev mapping (epoch => (strike => deposits))
    mapping(uint256 => mapping(uint256 => uint256))
        public totalEpochStrikeDeposits;

    /// @notice Total epoch deposits across all strikes
    /// @dev mapping (epoch => deposits)
    mapping(uint256 => uint256) public totalEpochDeposits;

    /// @notice Epoch deposits by user for each strike
    /// @dev mapping (epoch => (abi.encodePacked(user, strike) => user deposits))
    mapping(uint256 => mapping(bytes32 => uint256)) public userEpochDeposits;

    /// @notice Epoch usd balance per strike after accounting for rewards
    /// @dev mapping (epoch => (strike => balance))
    mapping(uint256 => mapping(uint256 => uint256))
        public totalEpochStrikeUsdBalance;

    // Puts purchased for each strike in an epoch
    /// @dev mapping (epoch => (strike => puts purchased))
    mapping(uint256 => mapping(uint256 => uint256))
        public totalEpochPutsPurchased;

    /// @notice Puts purchased by user for each strike
    /// @dev mapping (epoch => (abi.encodePacked(user, strike) => user puts purchased))
    mapping(uint256 => mapping(bytes32 => uint256))
        public userEpochPutsPurchased;

    /// @notice Premium collected per strike for an epoch
    /// @dev mapping (epoch => (strike => premium))
    mapping(uint256 => mapping(uint256 => uint256)) public totalEpochPremium;

    /// @notice User premium collected per strike for an epoch
    /// @dev mapping (epoch => (abi.encodePacked(user, strike) => user premium))
    mapping(uint256 => mapping(bytes32 => uint256)) public userEpochPremium;

    /// @dev epoch => settlement price
    mapping(uint256 => uint256) public settlementPrices;

    /*==== EVENTS ====*/

    event ExpireDelayToleranceUpdate(uint256 expireDelayTolerance);

    event PurchaseFeePercentageUpdate(uint256 purchaseFeePercentage);

    event AddressSet(bytes32 indexed name, address indexed destination);

    event LogWindowSizeUpdate(uint256 windowSizeInHours);

    event EmergencyWithdraw(address sender, uint256 ethWithdrawn);

    event NewStrike(uint256 epoch, uint256 strike);

    event Bootstrap(uint256 epoch);

    event NewDeposit(
        uint256 epoch,
        uint256 strike,
        uint256 amount,
        address user,
        address sender
    );

    event NewPurchase(
        uint256 epoch,
        uint256 strike,
        uint256 amount,
        uint256 premium,
        uint256 fee,
        address user,
        address sender
    );

    event NewSettle(
        uint256 epoch,
        uint256 strike,
        address user,
        uint256 amount,
        uint256 pnl
    );

    event NewWithdraw(
        uint256 epoch,
        uint256 strike,
        address user,
        uint256 amount,
        uint256 ethAmount
    );

    /*==== CONSTRUCTOR ====*/

    constructor(
        address _quote,
        address _base,
        address _optionPricing,
        address _chainlinkAggregator,
        address _volatilityOracle,
        address _feeDistributor
    ) {
        require(_quote != address(0), 'E1');
        require(_base != address(0), 'E1');
        require(_optionPricing != address(0), 'E1');
        require(_chainlinkAggregator != address(0), 'E1');
        require(_volatilityOracle != address(0), 'E1');
        require(_feeDistributor != address(0), 'E1');

        addresses['Quote'] = _quote;
        addresses['Base'] = _base;
        addresses['OptionPricing'] = _optionPricing;
        addresses['ChainlinkAggregator'] = _chainlinkAggregator;
        addresses['VolatilityOracle'] = _volatilityOracle;
        addresses['FeeDistributor'] = _feeDistributor;
        addresses['Governance'] = msg.sender;

        erc20Implementation = address(new ERC20PresetMinterPauserUpgradeable());
    }

    // Recieve function
    receive() external payable {}

    /*==== SETTER METHODS ====*/

    /// @notice Pauses the vault for emergency cases
    /// @dev Can only be called by governance
    /// @return Whether it was successfully paused
    function pause() external onlyGovernance returns (bool) {
        _pause();
        _updateFinalEpochBalances(false);
        return true;
    }

    /// @notice Unpauses the vault
    /// @dev Can only be called by governance
    /// @return Whether it was successfully unpaused
    function unpause() external onlyGovernance returns (bool) {
        _unpause();
        return true;
    }

    /// @notice Updates the delay tolerance for the expiry epoch function
    /// @dev Can only be called by governance
    /// @return Whether it was successfully updated
    function updateExpireDelayTolerance(uint256 _expireDelayTolerance)
        external
        onlyGovernance
        returns (bool)
    {
        expireDelayTolerance = _expireDelayTolerance;
        emit ExpireDelayToleranceUpdate(_expireDelayTolerance);
        return true;
    }

    /// @notice Update the purchase fee percentage
    /// @dev Can only be called by owner
    /// @param _purchaseFeePercentage The new fee
    /// @return Whether it was successfully updated
    function updatePurchaseFeePercentage(uint256 _purchaseFeePercentage)
        external
        onlyOwner
        returns (bool)
    {
        purchaseFeePercentage = _purchaseFeePercentage;
        emit PurchaseFeePercentageUpdate(_purchaseFeePercentage);
        return true;
    }

    /// @notice Update the exercise window size of an option
    /// @dev Can only be called by owner
    /// @param _windowSize The window size
    /// @return Whether it was successfully updated
    function updateWindowSize(uint256 _windowSize)
        external
        onlyOwner
        returns (bool)
    {
        windowSize = _windowSize;
        emit LogWindowSizeUpdate(_windowSize);
        return true;
    }

    /// @notice Sets (adds) a list of addresses to the address list
    /// @param names Names of the contracts
    /// @param destinations Addresses of the contract
    /// @return Whether the addresses were set
    function setAddresses(
        bytes32[] calldata names,
        address[] calldata destinations
    ) external onlyOwner returns (bool) {
        require(names.length == destinations.length, 'E2');
        for (uint256 i = 0; i < names.length; i++) {
            bytes32 name = names[i];
            address destination = destinations[i];
            addresses[name] = destination;
            emit AddressSet(name, destination);
        }
        return true;
    }

    /*==== METHODS ====*/

    /// @notice Transfers all funds to msg.sender
    /// @dev Can only be called by governance
    /// @return Whether emergency withdraw was successful
    function emergencyWithdraw()
        external
        onlyGovernance
        whenPaused
        returns (bool)
    {
        return true;
    }

    /// @notice Sets the current epoch as expired.
    /// @return Whether expire was successful
    function expireEpoch() external whenNotPaused nonReentrant returns (bool) {
        return true;
    }

    /// @notice Sets the current epoch as expired.
    /// @return Whether expire was successful
    function expireEpoch(uint256 settlementPrice)
        external
        onlyGovernance
        whenNotPaused
        nonReentrant
        returns (bool)
    {
        return true;
    }

    /// @dev Updates the final epoch eth balances per strike of the vault
    function _updateFinalEpochBalances(bool accountPremiums) internal {}

    /**
     * @notice Bootstraps a new epoch and mints option tokens equivalent to user deposits for the epoch
     * @return Whether bootstrap was successful
     */
    function bootstrap() external onlyOwner whenNotPaused returns (bool) {
        return true;
    }

    /**
     * @notice Deposits USD into the ssov-p to mint puts in the next epoch for selected strikes
     * @param strikeIndex Index of strike
     * @param user Address of the user to deposit for
     * @param amount Amount of USD to deposit
     * @return Whether deposit was successful
     */
    function deposit(
        uint256 strikeIndex,
        address user,
        uint256 amount
    ) external payable returns (bool) {
        return true;
    }

    /**
     * @notice Deposit ETH multiple times into different strike
     * @param strikeIndices Indices of strikes to deposit into
     * @param amounts Amount of USD to deposit into each strike index
     * @param user Address of the user to deposit for
     * @return Whether deposits went through successfully
     */
    function depositMultiple(
        uint256[] memory strikeIndices,
        uint256[] memory amounts,
        address user
    ) external payable returns (bool) {
        return true;
    }

    /**
     * @notice Internal function to handle USD deposits
     * @param maxStrike Max strike to sell puts at
     * @param amount Amout of USD to deposit
     * @param user Address for the user to deposit for
     */
    function _deposit(
        uint256 maxStrike,
        uint256 amount,
        address user
    ) internal nonReentrant whenNotPaused isEligibleSender {}

    /**
     * @notice Purchases puts for the current epoch
     * @param strikeIndex Strike index for current epoch
     * @param amount Amount of puts to purchase
     * @param user User to purchase options for
     * @return Whether purchase was successful
     */
    function purchase(
        uint256 strikeIndex,
        uint256 amount,
        address user
    )
        external
        payable
        whenNotPaused
        nonReentrant
        isEligibleSender
        returns (uint256, uint256)
    {}

    /**
     * @notice Exercise transfers `strike` USD to the user in exchange for the asset. Will also the burn the doTokens from the user.
     * @param strikeIndex Strike index for current epoch
     * @param amount Amount of puts to exercise
     * @param user Address of the user
     * @return Pnl and Fee
     */
    function exercise(
        uint256 strikeIndex,
        uint256 amount,
        address user
    ) external override returns (uint256, uint256) {}

    /**
     * @notice Withdraws balances for a strike in a completed epoch
     * @param withdrawEpoch Epoch to withdraw from
     * @param strikeIndex Index of strike
     * @return [ETH, DPX, rDPX] withdrawn
     */
    function withdraw(uint256 withdrawEpoch, uint256 strikeIndex)
        external
        whenNotPaused
        nonReentrant
        isEligibleSender
        returns (uint256[3] memory)
    {}

    /*==== PURE FUNCTIONS ====*/

    /// @notice Calculates the monthly expiry from a solidity date
    /// @param timestamp Timestamp from which the monthly expiry is to be calculated
    /// @return The monthly expiry
    function getMonthlyExpiryFromTimestamp(uint256 timestamp)
        public
        pure
        returns (uint256)
    {
        uint256 lastDay = BokkyPooBahsDateTimeLibrary.timestampFromDate(
            timestamp.getYear(),
            timestamp.getMonth() + 1,
            0
        );

        if (lastDay.getDayOfWeek() < 5) {
            lastDay = BokkyPooBahsDateTimeLibrary.timestampFromDate(
                lastDay.getYear(),
                lastDay.getMonth(),
                lastDay.getDay() - 7
            );
        }

        uint256 lastFridayOfMonth = BokkyPooBahsDateTimeLibrary
            .timestampFromDateTime(
                lastDay.getYear(),
                lastDay.getMonth(),
                lastDay.getDay() + 5 - lastDay.getDayOfWeek(),
                8,
                0,
                0
            );

        if (lastFridayOfMonth <= timestamp) {
            uint256 temp = BokkyPooBahsDateTimeLibrary.timestampFromDate(
                timestamp.getYear(),
                timestamp.getMonth() + 2,
                0
            );

            if (temp.getDayOfWeek() < 5) {
                temp = BokkyPooBahsDateTimeLibrary.timestampFromDate(
                    temp.getYear(),
                    temp.getMonth(),
                    temp.getDay() - 7
                );
            }

            lastFridayOfMonth = BokkyPooBahsDateTimeLibrary
                .timestampFromDateTime(
                    temp.getYear(),
                    temp.getMonth(),
                    temp.getDay() + 5 - temp.getDayOfWeek(),
                    8,
                    0,
                    0
                );
        }
        return lastFridayOfMonth;
    }

    /**
     * @notice Returns a concatenated string of a and b
     * @param a string a
     * @param b string b
     */
    function concatenate(string memory a, string memory b)
        internal
        pure
        returns (string memory)
    {
        return string(abi.encodePacked(a, b));
    }

    /*==== VIEWS ====*/

    /// @notice Calculate Fees
    /// @param price price of ETH
    /// @param strike strike price of the the ETH option
    /// @param amount amount of options being bought
    function calculateFees(
        uint256 price,
        uint256 strike,
        uint256 amount
    ) public view returns (uint256) {
        uint256 finalFee = (purchaseFeePercentage * amount) / 1e10;

        if (price < strike) {
            uint256 feeMultiplier = (((strike * 100) / (price)) - 100) + 100;
            finalFee = (feeMultiplier * finalFee) / 100;
        }

        return finalFee;
    }

    /**
     * @notice Returns start and end times for an epoch
     * @param epoch Target epoch
     */
    function getEpochTimes(uint256 epoch)
        public
        view
        epochGreaterThanZero(epoch)
        returns (uint256 start, uint256 end)
    {
        return (
            epochStartTimes[epoch],
            getMonthlyExpiryFromTimestamp(epochStartTimes[epoch])
        );
    }

    /**
     * @notice Returns epoch strikes array for an epoch
     * @param epoch Target epoch
     */
    function getEpochStrikes(uint256 epoch)
        external
        view
        epochGreaterThanZero(epoch)
        returns (uint256[] memory)
    {
        return epochStrikes[epoch];
    }

    /**
     * Returns epoch strike tokens array for an epoch
     * @param epoch Target epoch
     */
    function getEpochStrikeTokens(uint256 epoch)
        external
        view
        epochGreaterThanZero(epoch)
        returns (address[] memory)
    {
        uint256 length = epochStrikes[epoch].length;
        address[] memory _epochStrikeTokens = new address[](length);

        for (uint256 i = 0; i < length; i++) {
            _epochStrikeTokens[i] = epochStrikeTokens[epoch][
                epochStrikes[epoch][i]
            ];
        }

        return _epochStrikeTokens;
    }

    /**
     * @notice Returns total epoch strike deposits array for an epoch
     * @param epoch Target epoch
     */
    function getTotalEpochStrikeDeposits(uint256 epoch)
        external
        view
        epochGreaterThanZero(epoch)
        returns (uint256[] memory)
    {
        uint256 length = epochStrikes[epoch].length;
        uint256[] memory _totalEpochStrikeDeposits = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            _totalEpochStrikeDeposits[i] = totalEpochStrikeDeposits[epoch][
                epochStrikes[epoch][i]
            ];
        }

        return _totalEpochStrikeDeposits;
    }

    /**
     * @notice Returns user epoch deposits array for an epoch
     * @param epoch Target epoch
     * @param user Address of the user
     */
    function getUserEpochDeposits(uint256 epoch, address user)
        external
        view
        epochGreaterThanZero(epoch)
        returns (uint256[] memory)
    {
        uint256 length = epochStrikes[epoch].length;
        uint256[] memory _userEpochDeposits = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            uint256 strike = epochStrikes[epoch][i];
            bytes32 userStrike = keccak256(abi.encodePacked(user, strike));

            _userEpochDeposits[i] = userEpochDeposits[epoch][userStrike];
        }

        return _userEpochDeposits;
    }

    /**
     * @notice Returns total epoch puts purchased array for an epoch
     * @param epoch Target epoch
     */
    function getTotalEpochPutsPurchased(uint256 epoch)
        external
        view
        epochGreaterThanZero(epoch)
        returns (uint256[] memory)
    {
        uint256 length = epochStrikes[epoch].length;
        uint256[] memory _totalEpochPutsPurchased = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            _totalEpochPutsPurchased[i] = totalEpochPutsPurchased[epoch][
                epochStrikes[epoch][i]
            ];
        }

        return _totalEpochPutsPurchased;
    }

    /**
     * @notice Returns user epoch puts purchased array for an epoch
     * @param epoch Target epoch
     * @param user Address of the user
     */
    function getUserEpochPutsPurchased(uint256 epoch, address user)
        external
        view
        epochGreaterThanZero(epoch)
        returns (uint256[] memory)
    {
        uint256 length = epochStrikes[epoch].length;
        uint256[] memory _userEpochPutsPurchased = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            uint256 strike = epochStrikes[epoch][i];
            bytes32 userStrike = keccak256(abi.encodePacked(user, strike));

            _userEpochPutsPurchased[i] = userEpochPutsPurchased[epoch][
                userStrike
            ];
        }

        return _userEpochPutsPurchased;
    }

    /**
     * @notice Returns total epoch premium array for an epoch
     * @param epoch Target epoch
     */
    function getTotalEpochPremium(uint256 epoch)
        external
        view
        epochGreaterThanZero(epoch)
        returns (uint256[] memory)
    {
        uint256 length = epochStrikes[epoch].length;
        uint256[] memory _totalEpochPremium = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            _totalEpochPremium[i] = totalEpochPremium[epoch][
                epochStrikes[epoch][i]
            ];
        }

        return _totalEpochPremium;
    }

    /**
     * @notice Returns user epoch premium array for an epoch
     * @param epoch Target epoch
     * @param user Address of the user
     */
    function getUserEpochPremium(uint256 epoch, address user)
        external
        view
        epochGreaterThanZero(epoch)
        returns (uint256[] memory)
    {
        uint256 length = epochStrikes[epoch].length;
        uint256[] memory _userEpochPremium = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            uint256 strike = epochStrikes[epoch][i];
            bytes32 userStrike = keccak256(abi.encodePacked(user, strike));

            _userEpochPremium[i] = userEpochPremium[epoch][userStrike];
        }

        return _userEpochPremium;
    }

    /**
     * @notice Returns the price of ETH/USD via chainlink
     */
    function getUsdPrice() public view returns (uint256) {
        (, int256 price, , , ) = IChainlinkV3Aggregator(
            getAddress('ChainlinkAggregator')
        ).latestRoundData();

        return uint256(price);
    }

    /**
     * @notice Returns true if exercise can be called
     * @param expiry The expiry of the option
     */
    function isExerciseWindow(uint256 expiry) public view returns (bool) {
        return ((block.timestamp >= expiry - windowSize) &&
            (block.timestamp < expiry));
    }

    /**
     * @notice Gets the address of a set contract
     * @param name Name of the contract
     * @return The address of the contract
     */
    function getAddress(bytes32 name) public view returns (address) {
        return addresses[name];
    }

    /*==== MODIFIERS ====*/

    modifier onlyGovernance() {
        require(msg.sender == getAddress('Governance'), 'E22');
        _;
    }

    modifier epochGreaterThanZero(uint256 epoch) {
        require(epoch > 0, 'E13');
        _;
    }
}

// ERROR MAPPING:
// {
//   "E1": "AtlanticPool: Address cannot be a zero address",
//   "E2": "AtlanticPool: Input lengths must match",
//   "E3": "AtlanticPool: Epoch must not be expired",
//   "E4": "AtlanticPool: Cannot expire epoch before epoch's expiry",
//   "E5": "AtlanticPool: Already bootstrapped",
//   "E6": "AtlanticPool: Strikes have not been set for next epoch",
//   "E7": "AtlanticPool: Previous epoch has not expired",
//   "E8": "AtlanticPool: Deposit already started",
//   "E9": "AtlanticPool: Cannot set next strikes before current epoch's expiry",
//   "E10": "AtlanticPool: Invalid strike index",
//   "E11": "AtlanticPool: Invalid amount",
//   "E12": "AtlanticPool: Invalid strike",
//   "E13": "AtlanticPool: Epoch passed must be greater than 0",
//   "E14": "AtlanticPool: Option must be in exercise window",
//   "E15": "AtlanticPool: Cannot exercise with a smaller PnL",
//   "E16": "AtlanticPool: Option token balance is not enough",
//   "E17": "AtlanticPool: Epoch must be expired",
//   "E18": "AtlanticPool: User strike deposit amount must be greater than zero",
//   "E19": "AtlanticPool: Deposit is only available between epochs",
//   "E20": "AtlanticPool: Not bootstrapped",
//   "E21": "AtlanticPool: Can not call function in exercise window",
//   "E22": "AtlanticPool: Caller is not governance",
//   "E23": "AtlanticPool: Expire delay tolerance exceeded",
//   "E24": "AtlanticPool: Cannot purchase past epoch expiry",
//   "E25": "AtlanticPool: Insufficient ETH transferred"
// }
