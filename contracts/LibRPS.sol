// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, euint8, externalEuint8, ebool} from "@fhevm/solidity/lib/FHE.sol";

struct RPSStruct {
    // The packed encrypted state
    euint8 gameState;
    // The final result (0=Pending, 1=P1 Win, 2=P2 Win, 3=Draw)
    // We store this publicly so the frontend can see the game is over.
    // In a real mainnet scenario, this would be decrypted via Gateway.
    // For this example, we use FHE.decrypt (Simpler for Devnet).
    uint8 publicResult;
    address player1;
    address player2;
    // To prevent re-playing in the same instance
    bool player1Moved;
    bool player2Moved;
    uint256 requestId;
    uint8 pubGameState;
    address winner;
    address callback;
}

library LibRPS {
    // --- Constants ---
    uint8 internal constant MASK_P1 = 7; // 00000111
    uint8 internal constant MASK_P2 = 56; // 00111000

    // Valid Moves (Powers of 2)
    uint8 internal constant ROCK = 1;
    uint8 internal constant PAPER = 2;
    uint8 internal constant SCISSORS = 4;

    /// @notice Storage slot for the diamond storage pattern using ERC-7201
    bytes32 private constant RPSStorageLocation =
        keccak256(abi.encode(uint256(keccak256("RPS.storage")) - 1)) & ~bytes32(uint256(0xff));

    function getStorage() internal pure returns (RPSStruct storage s) {
        bytes32 position = RPSStorageLocation;
        assembly {
            s.slot := position
        }
    }
}
