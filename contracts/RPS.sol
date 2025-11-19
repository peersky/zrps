// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, euint8, externalEuint8, ebool} from "@fhevm/solidity/lib/FHE.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {LibRPS, RPSStruct} from "./LibRPS.sol";

interface IResultCallback {
    function RPSContractCallback(address winner, uint8 endState) external;
}

/**
 * @title Encrypted Rock Paper Scissors (Bitmask Optimized)
 * @dev Logic contract meant to be cloned.
 * State Layout: [unused:2] [P2_Move:3] [P1_Move:3]
 */
contract RPS is ZamaEthereumConfig, Initializable {
    event ResultsPublished(address winner, uint8 state);
    event AllPlayersMadeMove();
    using LibRPS for RPSStruct;
    using FHE for euint8;

    // --- Events ---
    event MoveSubmitted(address indexed player);
    event GameResolved(string result, uint8 winnerCode);

    // --- Initialization (For Clones) ---

    /**
     * @dev Replaces constructor for clones.
     */
    function initialize(address _p1, address _p2, address resultCallback) public initializer {
        RPSStruct storage s = LibRPS.getStorage();
        require(_p1 != _p2, "Same players");
        s.player1 = _p1;
        s.player2 = _p2;
        s.callback = resultCallback;
    }

    /**
     * @notice Submit an encrypted move.
     * @param encryptedMove Input ciphertext (should encrypt 1, 2, or 4).
     * @param inputProof ZK proof verifying the ciphertext.
     */
    function play(externalEuint8 encryptedMove, bytes calldata inputProof) public {
        RPSStruct storage s = LibRPS.getStorage();
        require(s.winner == address(0), "Game over");
        require(msg.sender == s.player1 || msg.sender == s.player2, "Not a player");
        require(msg.sender == s.player1 ? s.player1Moved == false : s.player2Moved == false, "already made a move");

        // 1. Convert Input to euint8
        euint8 move = FHE.fromExternal(encryptedMove, inputProof);

        // 2. Sanitize Input (Optional but recommended)
        // We mask it to ensure no overflow bits, though strictly
        // preventing '3' (Rock+Paper) costs extra gas.
        // Here we just ensure it fits in 3 bits.
        move = FHE.and(move, LibRPS.MASK_P1);

        // 3. Update Logic using Multiplexers (FHE.select)
        // We must ensure a player cannot overwrite their own move if they already played,
        // and cannot overwrite the opponent's move.

        if (msg.sender == s.player1) {
            s.gameState = FHE.or(s.gameState, move);
            s.player1Moved = true;
            if (s.player2 == address(0)) {
                // 1. Generate 0-255 (256 is a power of two, so this works)
                euint8 rnd = FHE.randEuint8();

                // 2. Map to Moves using Thresholds (Select Logic)
                // Range 1: 0-84   -> Rock (1)
                // Range 2: 85-169 -> Paper (2)
                // Range 3: 170+   -> Scissors (4)

                euint8 aiBaseMove = FHE.select(
                    FHE.lt(rnd, 85),
                    FHE.asEuint8(1), // Rock
                    FHE.select(
                        FHE.lt(rnd, 170),
                        FHE.asEuint8(2), // Paper
                        FHE.asEuint8(4) // Scissors
                    )
                );

                // 3. Shift to P2 Position (Bits 3-5)
                // Rock(1) << 3 = 8
                // Paper(2) << 3 = 16
                // Scissors(4) << 3 = 32
                euint8 aiMoveShifted = FHE.shl(aiBaseMove, 3);

                // 4. Update State
                s.gameState = FHE.or(s.gameState, aiMoveShifted);
                s.player2Moved = true;
            }
        } else {
            euint8 moveShifted = FHE.shl(move, 3);
            s.gameState = FHE.or(s.gameState, moveShifted);
            s.player2Moved = true;
        }
        s.gameState.allowThis();
        emit MoveSubmitted(msg.sender);

        if (s.player1Moved && s.player2Moved) {
            emit AllPlayersMadeMove();
            FHE.makePubliclyDecryptable(s.gameState);
        }
    }

    // --- Resolution Logic ---
    function computeResult(bytes memory abiEncodedState, bytes memory decryptionProof) public {
        RPSStruct storage s = LibRPS.getStorage();
        require(s.player1Moved && s.player2Moved, "Not all players made a move yet");
        require(s.winner == address(0), "Result already computed");
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(s.gameState);
        FHE.checkSignatures(cts, abiEncodedState, decryptionProof);

        uint8 pubState = abi.decode(abiEncodedState, (uint8));

        // Extract slots
        uint8 p1 = pubState & LibRPS.MASK_P1;
        uint8 p2 = (pubState & LibRPS.MASK_P2) >> 3;

        // 1. Handle edge cases
        if (p1 == 0 || p2 == 0) {
            // If one is 0 and other is valid, the valid one wins.
            if (p1 != 0) s.winner = s.player1;
            else if (p2 != 0) s.winner = s.player2;
            else s.winner = address(0); // Both invalid
        }
        // 2. Handle Draw
        else if (p1 == p2) {
            s.winner = address(0); // Explicitly handle Draw (or use a specific address)
            // Note: You might want to emit "Draw" here, as address(0) might look like "game not finished".
            // Alternatively, reset the game to allow re-play.
        }
        // 3. Handle P1 Wins
        else if (
            (p1 == LibRPS.ROCK && p2 == LibRPS.SCISSORS) || // && NOT ==
            (p1 == LibRPS.PAPER && p2 == LibRPS.ROCK) ||
            (p1 == LibRPS.SCISSORS && p2 == LibRPS.PAPER)
        ) {
            s.winner = s.player1;
        }
        // 4. Default to P2 Wins
        else {
            s.winner = s.player2;
        }

        emit ResultsPublished(s.winner, pubState);
        if (s.callback != address(0) && s.winner != address(0)) {
            IResultCallback(s.callback).RPSContractCallback(s.winner, pubState);
        }
    }

    function result() public view returns (address) {
        return LibRPS.getStorage().winner;
    }

    function readState() public pure returns (RPSStruct memory) {
        return LibRPS.getStorage();
    }
}
