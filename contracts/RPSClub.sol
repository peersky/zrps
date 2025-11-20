// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {RPS, IResultCallback} from "./RPS.sol";

/**
 * @title RPS Club - A Factory for Rock-Paper-Scissors Games
 * @notice This contract acts as a factory to create new Rock-Paper-Scissors (RPS) game instances using the EIP-1167 Clones pattern.
 * @dev It also serves as a callback receiver for game results and an ERC1155 token minter to reward winners.
 * Players accumulate wins, and can "exit" to mint an NFT representing their total win count (level).
 */
contract RPSClub is ERC1155, IResultCallback {
    /// @notice The master implementation of the RPS logic contract. Clones are made from this address.
    RPS immutable rpsContract;
    using Clones for address;
    /// @notice Maps a player's address to their accumulated number of wins.
    mapping(address => uint256) wins;
    /// @notice A whitelist of valid game instance addresses that are allowed to call the result callback.
    mapping(address => bool) public instances;
    /// @notice Emitted when a new game instance is created.
    event GameCreated(address indexed instance, address indexed player1, address indexed player2);

    /**
     * @notice Sets up the factory with the ERC1155 URI and the master RPS contract address.
     * @param _uri The base URI for the ERC1155 tokens.
     * @param _rps The address of the deployed RPS logic contract implementation.
     */
    constructor(string memory _uri, address _rps) ERC1155(_uri) {
        rpsContract = RPS(_rps);
    }

    /**
     * @notice Creates a new RPS game instance (clone).
     * @dev Deploys an EIP-1167 minimal proxy, initializes it, and registers it as a valid instance.
     * @param p1 The address of player 1.
     * @param p2 The address of player 2. Use address(0) for a single-player game.
     */
    function createGame(address p1, address p2) external {
        require(p1 != address(0), "need at least 1 player");
        address instance = address(rpsContract).clone();
        instances[instance] = true;
        RPS(instance).initialize(p1, p2, address(this));
        emit GameCreated(instance, p1, p2);
    }

    /**
     * @notice The callback function that valid game instances call to report a winner.
     * @dev The `msg.sender` is verified to be a valid game instance created by this factory.
     * This function increments the win count for the winning player.
     * @param winner The address of the player who won the game.
     * @param endState The final decrypted state of the game (unused in this implementation).
     */
    function RPSContractCallback(address winner, uint8 endState) external {
        require(instances[msg.sender], "invalid sender");
        wins[winner]++;
    }

    /**
     * @notice Allows a player to claim their winnings by minting an NFT.
     * @dev Mints an ERC1155 token where the token ID is the player's total win count (level).
     * After minting, the player's win count is reset to zero.
     */
    function exit() external {
        uint256 level = wins[msg.sender];
        wins[msg.sender] = 0;
        require(level > 0, "you have nothing");
        _mint(msg.sender, level, 1, "");
    }
}
