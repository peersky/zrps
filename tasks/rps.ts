import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
// import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk";
// --- Constants & Helpers ---

const MOVES = {
  ROCK: 1,
  PAPER: 2,
  SCISSORS: 4,
};

function parseMove(moveStr: string): number {
  const m = moveStr.toUpperCase();
  if (m === "ROCK" || m === "1") return MOVES.ROCK;
  if (m === "PAPER" || m === "2") return MOVES.PAPER;
  if (m === "SCISSORS" || m === "4") return MOVES.SCISSORS;
  throw new Error(`Invalid move: ${moveStr}. Use ROCK, PAPER, or SCISSORS.`);
}

function moveFromInt(moveInt: number | bigint): string {
  const m = Number(moveInt);
  if (m === 1) return "ROCK";
  if (m === 2) return "PAPER";
  if (m === 4) return "SCISSORS";
  return "UNKNOWN";
}

// --- Task 1: Create Game ---

task("task:rps:create", "Creates a new RPS Game via the Club Factory")
  .addParam("opponent", "The address of the opponent (Player 2)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const [deployer] = await ethers.getSigners();

    console.log(`\n♦️  Creating game: ${deployer.address} vs ${taskArguments.opponent}`);

    // 1. Get RPSClub
    const rpsClubDeployment = await deployments.get("RPSClub");
    const rpsClub = await ethers.getContractAt("RPSClub", rpsClubDeployment.address);

    // 2. Send Transaction
    const tx = await rpsClub.createGame(deployer.address, taskArguments.opponent);
    console.log(`⏳ Tx sent: ${tx.hash}`);
    const receipt = await tx.wait();

    // 3. Find Event
    const event = receipt?.logs
      .map((log) => {
        try {
          return rpsClub.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log) => log?.name === "GameCreated");

    if (event) {
      console.log(`\n✅ Game Created!`);
      console.log(`   Address:  ${event.args[0]}`);
      console.log(`   Player 1: ${event.args[1]}`);
      console.log(`   Player 2: ${event.args[2]}\n`);
    } else {
      console.error("❌ Game created, but 'GameCreated' event not found in logs.");
    }
  });

// --- Task 2: Play Move ---

task("task:rps:play", "Submits an encrypted move to an existing game")
  .addParam("game", "The address of the RPS Game instance")
  .addParam("move", "ROCK, PAPER, or SCISSORS")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, fhevm } = hre;
    const [signer] = await ethers.getSigners();

    await fhevm.initializeCLIApi();

    const rps = await ethers.getContractAt("RPS", taskArguments.game);
    const moveInt = parseMove(taskArguments.move);

    console.log(`\n🔒 Preparing to encrypt move '${taskArguments.move}' (${moveInt})...`);
    console.log(`   Game: ${taskArguments.game}`);
    console.log(`   Player: ${signer.address}`);

    const encrypted = await fhevm.createEncryptedInput(taskArguments.game, signer.address).add8(moveInt).encrypt();

    // --- FIX: ADD MANUAL GAS LIMIT ---
    // FHE operations + Randomness are heavy. We bypass estimateGas by setting this explicit limit.
    const tx = await rps.connect(signer).play(encrypted.handles[0], encrypted.inputProof);

    console.log(`⏳ Tx sent: ${tx.hash}`);
    await tx.wait();
    console.log(`✅ Move submitted successfully!\n`);
  });

// --- Task 3: View State ---

task("task:rps:view", "Views the public status of the game")
  .addParam("game", "The address of the RPS Game instance")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers } = hre;
    const rps = await ethers.getContractAt("RPS", taskArguments.game);

    console.log(`\n🔍 Fetching state for ${taskArguments.game}...`);

    // The contract returns a Struct. Ethers returns this as an array-like object.
    // Struct Layout based on your solidity code:
    // [0] gameState (euint8), [1] publicResult, [2] player1, [3] player2,
    // [4] p1Moved, [5] p2Moved, [6] reqId, [7] pubGameState, [8] winner, [9] callback
    const state = await rps.readState();

    const p1 = state.player1;
    const p2 = state.player2;
    const p1Moved = state.player1Moved;
    const p2Moved = state.player2Moved;
    const winner = state.winner;
    const pubGameState = Number(state.pubGameState);

    console.log(`\n--- Players ---`);
    console.log(`Player 1: ${p1} ${p1Moved ? "✅ (Moved)" : "Waiting..."}`);
    console.log(`Player 2: ${p2} ${p2Moved ? "✅ (Moved)" : "Waiting..."}`);

    console.log(`\n--- Status ---`);
    if (winner === ethers.ZeroAddress) {
      console.log(`Result: ⏳ Game in progress (or Draw pending resolution)`);
    } else {
      if (winner === p1) console.log(`Result: 🏆 Player 1 WINS`);
      else if (winner === p2) console.log(`Result: 🏆 Player 2 WINS`);
      else console.log(`Result: Draw (Winner address is ${winner})`);

      // Parse the revealed bits
      const p1MoveBits = pubGameState & 7;
      const p2MoveBits = (pubGameState & 56) >> 3;
      console.log(`\n--- Final Hands ---`);
      console.log(`P1 Played: ${moveFromInt(p1MoveBits)}`);
      console.log(`P2 Played: ${moveFromInt(p2MoveBits)}`);
    }
    console.log("");
  });
// Add this helper function at the top
async function retry<T>(fn: () => Promise<T>, retries = 5, delay = 5000): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (retries === 0) throw err;
    // Retry on 500 (Internal Error) or 504 (Timeout)
    if (err?.cause?.status === 500 || err?.cause?.status === 504) {
      console.log(`   ⚠️  Relayer busy (${err.cause.status}). Retrying in ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return retry(fn, retries - 1, delay * 1.5);
    }
    throw err;
  }
}

// Update the action in rps:resolve
task("rps:resolve", "Fetches encrypted state, decrypts via Zama KMS, and submits proof")
  .addParam("game", "The address of the RPS Game instance")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers } = hre;
    const [signer] = await ethers.getSigners();
    const { createInstance, SepoliaConfig } = await import("@zama-fhe/relayer-sdk/node");

    const rps = await ethers.getContractAt("RPS", taskArguments.game);
    console.log(`\n🕵️  Checking game status for ${taskArguments.game}...`);

    const state = await rps.readState();
    // ... (validations) ...

    // Handle Padding
    const handleHex = ethers.zeroPadValue(ethers.toBeHex(state.gameState), 32);
    console.log(`   Encrypted Handle: ${handleHex}`);

    const instance = await createInstance(SepoliaConfig);

    console.log(`🔓 Requesting decryption...`);

    // --- RETRY LOGIC ---
    const { abiEncodedClearValues, decryptionProof } = await retry(async () => {
      return await instance.publicDecrypt([handleHex]);
    });

    console.log(`📜 Decryption successful!`);

    // ... (submission logic) ...
    console.log(`🚀 Submitting proof to contract...`);
    const tx = await rps.connect(signer).computeResult(abiEncodedClearValues, decryptionProof, { gasLimit: 5_000_000 });
    console.log(`⏳ Tx: ${tx.hash}`);
    await tx.wait();

    const winner = await rps.result();
    console.log(`\n🏆 Winner: ${winner}`);
  });
