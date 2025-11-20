// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {FHE} from "@fhevm/solidity/lib/FHE.sol";
import {CoprocessorConfig} from "@fhevm/solidity/lib/Impl.sol";
import {ZamaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title   ZamaEthereumConfig.
 * @dev     This contract can be inherited by a contract wishing to use the FHEVM contracts provided by Zama
 *          on the Ethereum (mainnet) network (chainId = 1) or Sepolia (testnet) network (chainId = 11155111).
 *          Other providers may offer similar contracts deployed at different addresses.
 *          If you wish to use them, you should rely on the instructions from these providers.
 */
abstract contract ZamaEthereumConfig {
    constructor() {
        FHE.setCoprocessor(ZamaConfig.getEthereumCoprocessorConfig());
    }

    function confidentialProtocolId() public view returns (uint256) {
        return ZamaConfig.getConfidentialProtocolId();
    }
}

/**
 * @title ZamaEthereumConfigInitializable
 * @dev A clone-compatible version of ZamaEthereumConfig.
 * Includes a custom initializer modifier to avoid OpenZeppelin dependencies.
 */
abstract contract ZamaEthereumConfigInitializable {
    /**
     * @dev Indicates that the contract has been initialized.
     */
    bool private _initialized;

    /**
     * @dev Indicates that the contract is in the process of being initialized.
     */
    bool private _initializing;

    /**
     * @dev Modifier to protect an initializer function from being invoked twice.
     */
    modifier initializer() {
        // If the contract is already initialized, we revert.
        // We allow re-entrancy into the modifier if we are currently initializing
        // (useful for inheritance chains), but simplest case is just check _initialized.
        require(!_initialized && !_initializing, "ZamaConfig: already initialized");

        _initializing = true;
        _initialized = true;
        _;
        _initializing = false;
    }

    /**
     * @dev ToDo: Constructor to prevent initialization of implementation contracts.
     * This is a security best practice for proxies.
     */
    constructor() {
        FHE.setCoprocessor(ZamaConfig.getEthereumCoprocessorConfig());
    }

    /**
     * @dev Should be called inside your proxy's initialize function.
     * This sets up the FHE coprocessor configuration for the specific network.
     */
    function __ZamaEthereumConfig_init() internal onlyInitializing {
        FHE.setCoprocessor(ZamaConfig.getEthereumCoprocessorConfig());
    }

    /**
     * @dev Helper to ensure internal init is only called from within an initializer.
     */
    modifier onlyInitializing() {
        require(_initializing, "ZamaConfig: function can only be called during initialization");
        _;
    }

    /**
     * @dev Exposes the protocol ID, matching the original ZamaEthereumConfig interface.
     */
    function confidentialProtocolId() public view virtual returns (uint256) {
        return ZamaConfig.getConfidentialProtocolId();
    }
}
