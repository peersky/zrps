import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { RPS, RPS__factory } from "../types";
import { expect } from "chai";

enum moveEnum {
  ROCK = 1,
  PAPER = 2,
  SCISSORS = 4,
}

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  malfurion: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("RPS")) as RPS__factory;
  const rpsContract = (await factory.deploy()) as RPS;
  const rpsContractAddress = await rpsContract.getAddress();

  return { rpsContract, rpsContractAddress };
}

interface EncryptedInput {
  handles: Uint8Array[];
  inputProof: Uint8Array;
}

interface PossibleInputs {
  ROCK: EncryptedInput;
  SCISSORS: EncryptedInput;
  PAPER: EncryptedInput;
  ILLICIT_INPUT_1: EncryptedInput;
  ILLICIT_INPUT_2: EncryptedInput;
  EMPTY_INPUT: EncryptedInput;
}

interface PossibileEncryptedMoves {
  Alice: PossibleInputs;
  Bob: PossibleInputs;
  Malfurion: PossibleInputs;
}

const bothMoves = (signers: Signers, c: RPS) => async (moveP1: EncryptedInput, moveP2: EncryptedInput) => {
  {
    const { handles, inputProof } = moveP1;
    await c.connect(signers.alice).play(handles[0], inputProof);
  }
  {
    const { handles, inputProof } = moveP2;
    await c.connect(signers.bob).play(handles[0], inputProof);
  }
  const encryptedState = (await c.readState())[0];
  const { abiEncodedClearValues, decryptionProof } = await fhevm.publicDecrypt([encryptedState]);
  return { abiEncodedClearValues, decryptionProof };
};

const getWinner = (signers: Signers, c: RPS) => async (moveP1: EncryptedInput, moveP2: EncryptedInput) => {
  const { abiEncodedClearValues, decryptionProof } = await bothMoves(signers, c)(moveP1, moveP2);
  await c.computeResult(abiEncodedClearValues, decryptionProof);
  const { winner, pubGameState } = await c.readState();
  return { winner, pubGameState };
};

describe("RPS.sol", function () {
  let signers: Signers;
  let rpsContract: RPS;
  let rpsContractAddress: string;
  let possibilities: PossibileEncryptedMoves;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2], malfurion: ethSigners[3] };
  });
  describe("Both players are present", () => {
    beforeEach(async function () {
      // Check whether the tests are running against an FHEVM mock environment
      if (!fhevm.isMock) {
        console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
        this.skip();
      }

      ({ rpsContract, rpsContractAddress } = await deployFixture());
      possibilities = {
        Alice: {
          ROCK: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.alice.address)
            .add8(moveEnum.ROCK)
            .encrypt(),
          PAPER: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.alice.address)
            .add8(moveEnum.PAPER)
            .encrypt(),
          SCISSORS: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.alice.address)
            .add8(moveEnum.SCISSORS)
            .encrypt(),
          ILLICIT_INPUT_1: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.alice.address)
            .add8(3)
            .encrypt(),
          ILLICIT_INPUT_2: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.alice.address)
            .add8(255)
            .encrypt(),
          EMPTY_INPUT: await fhevm.createEncryptedInput(rpsContractAddress, signers.alice.address).add8(0).encrypt(),
        },
        Bob: {
          ROCK: await fhevm.createEncryptedInput(rpsContractAddress, signers.bob.address).add8(moveEnum.ROCK).encrypt(),
          PAPER: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.bob.address)
            .add8(moveEnum.PAPER)
            .encrypt(),
          SCISSORS: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.bob.address)
            .add8(moveEnum.SCISSORS)
            .encrypt(),
          ILLICIT_INPUT_1: await fhevm.createEncryptedInput(rpsContractAddress, signers.bob.address).add8(3).encrypt(),
          ILLICIT_INPUT_2: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.bob.address)
            .add8(255)
            .encrypt(),
          EMPTY_INPUT: await fhevm.createEncryptedInput(rpsContractAddress, signers.bob.address).add8(0).encrypt(),
        },
        Malfurion: {
          ROCK: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.malfurion.address)
            .add8(moveEnum.ROCK)
            .encrypt(),
          PAPER: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.malfurion.address)
            .add8(moveEnum.PAPER)
            .encrypt(),
          SCISSORS: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.malfurion.address)
            .add8(moveEnum.SCISSORS)
            .encrypt(),
          ILLICIT_INPUT_1: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.malfurion.address)
            .add8(3)
            .encrypt(),
          ILLICIT_INPUT_2: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.malfurion.address)
            .add8(255)
            .encrypt(),
          EMPTY_INPUT: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.malfurion.address)
            .add8(0)
            .encrypt(),
        },
      };
      await rpsContract.initialize(signers.alice.address, signers.bob.address, ethers.ZeroAddress);
    });

    describe("happy path", () => {
      it("encrypted count should be uninitialized after deployment", async function () {
        const state = await rpsContract.readState();
        expect(state.gameState).to.eq(ethers.ZeroHash);
      });

      it("make move by player1 - paper", async function () {
        const { handles, inputProof } = possibilities.Alice.PAPER;
        await expect(rpsContract.connect(signers.alice).play(handles[0], inputProof)).to.emit(
          rpsContract,
          "MoveSubmitted",
        );
      });
      it("make move by player1 - scissors", async function () {
        const { handles, inputProof } = possibilities.Alice.SCISSORS;
        await expect(rpsContract.connect(signers.alice).play(handles[0], inputProof)).to.emit(
          rpsContract,
          "MoveSubmitted",
        );
      });
      it("make move by player1 - rock", async function () {
        const { handles, inputProof } = possibilities.Alice.ROCK;
        await expect(rpsContract.connect(signers.alice).play(handles[0], inputProof)).to.emit(
          rpsContract,
          "MoveSubmitted",
        );
      });
      it("make move by player2 - paper", async function () {
        const { handles, inputProof } = possibilities.Bob.PAPER;
        await expect(rpsContract.connect(signers.bob).play(handles[0], inputProof)).to.emit(
          rpsContract,
          "MoveSubmitted",
        );
      });
      it("make move by player2 - scissors", async function () {
        const { handles, inputProof } = possibilities.Bob.SCISSORS;
        await expect(rpsContract.connect(signers.bob).play(handles[0], inputProof)).to.emit(
          rpsContract,
          "MoveSubmitted",
        );
      });
      it("make move by player2 - rock", async function () {
        const { handles, inputProof } = possibilities.Bob.ROCK;
        await expect(rpsContract.connect(signers.bob).play(handles[0], inputProof)).to.emit(
          rpsContract,
          "MoveSubmitted",
        );
      });
      it("both players", async function () {
        {
          const { handles, inputProof } = possibilities.Alice.ROCK;
          await expect(rpsContract.connect(signers.alice).play(handles[0], inputProof)).to.emit(
            rpsContract,
            "MoveSubmitted",
          );
        }
        {
          const { handles, inputProof } = possibilities.Bob.ROCK;
          await expect(rpsContract.connect(signers.bob).play(handles[0], inputProof))
            .to.emit(rpsContract, "MoveSubmitted")
            .to.emit(rpsContract, "AllPlayersMadeMove");
        }
      });
      describe("When all moves submitted", () => {
        it("can calculate results", async () => {
          const bothMovesFn = bothMoves(signers, rpsContract);
          await bothMovesFn(possibilities.Alice.ROCK, possibilities.Bob.SCISSORS);
          const encryptedState = (await rpsContract.readState())[0];
          const { abiEncodedClearValues, decryptionProof } = await fhevm.publicDecrypt([encryptedState]);

          await expect(rpsContract.computeResult(abiEncodedClearValues, decryptionProof)).to.emit(
            rpsContract,
            "ResultsPublished",
          );
        });
        it("gets correct winner - ROCKS / SCISSORS", async () => {
          const getWinnerFn = getWinner(signers, rpsContract);
          const { winner } = await getWinnerFn(possibilities.Alice.ROCK, possibilities.Bob.SCISSORS);
          expect(winner).eq(signers.alice.address);
        });
        it("gets correct winner - ROCKS / PAPER", async () => {
          const getWinnerFn = getWinner(signers, rpsContract);
          const { winner } = await getWinnerFn(possibilities.Alice.ROCK, possibilities.Bob.PAPER);
          expect(winner).eq(signers.bob.address);
        });
        it("gets correct winner - ROCKS / ROCK", async () => {
          const getWinnerFn = getWinner(signers, rpsContract);
          const { winner } = await getWinnerFn(possibilities.Alice.ROCK, possibilities.Bob.ROCK);
          expect(winner).eq(ethers.ZeroAddress);
        });
        it("gets correct winner - SCISSORS / SCISSORS", async () => {
          const getWinnerFn = getWinner(signers, rpsContract);
          const { winner } = await getWinnerFn(possibilities.Alice.SCISSORS, possibilities.Bob.SCISSORS);
          expect(winner).eq(ethers.ZeroAddress);
        });
        it("gets correct winner - SCISSORS / PAPER", async () => {
          const getWinnerFn = getWinner(signers, rpsContract);
          const { winner } = await getWinnerFn(possibilities.Alice.SCISSORS, possibilities.Bob.PAPER);
          expect(winner).eq(signers.alice.address);
        });
        it("gets correct winner - SCISSORS / ROCK", async () => {
          const getWinnerFn = getWinner(signers, rpsContract);
          const { winner } = await getWinnerFn(possibilities.Alice.SCISSORS, possibilities.Bob.ROCK);
          expect(winner).eq(signers.bob.address);
        });
        it("gets correct winner - PAPER / SCISSORS", async () => {
          const getWinnerFn = getWinner(signers, rpsContract);
          const { winner } = await getWinnerFn(possibilities.Alice.PAPER, possibilities.Bob.SCISSORS);
          expect(winner).eq(signers.bob.address);
        });
        it("gets correct winner - PAPER / PAPER", async () => {
          const getWinnerFn = getWinner(signers, rpsContract);
          const { winner } = await getWinnerFn(possibilities.Alice.PAPER, possibilities.Bob.PAPER);
          expect(winner).eq(ethers.ZeroAddress);
        });
        it("gets correct winner - PAPER / ROCK", async () => {
          const getWinnerFn = getWinner(signers, rpsContract);
          const { winner } = await getWinnerFn(possibilities.Alice.PAPER, possibilities.Bob.ROCK);
          expect(winner).eq(signers.alice.address);
        });
      });
    });
    describe("Unhappy path", () => {
      it("external player cannot participate", async function () {
        const { handles, inputProof } = possibilities.Malfurion.PAPER;
        await expect(rpsContract.connect(signers.malfurion).play(handles[0], inputProof)).to.revertedWith(
          "Not a player",
        );
      });

      it("malicious agent cannot submit on behalf of participant", async function () {
        const { handles, inputProof } = possibilities.Alice.PAPER;
        await expect(rpsContract.connect(signers.malfurion).play(handles[0], inputProof)).to.revertedWith(
          "Not a player",
        );
      });

      it("cannot repeat moves", async function () {
        {
          const { handles, inputProof } = possibilities.Alice.ROCK;
          await expect(rpsContract.connect(signers.alice).play(handles[0], inputProof)).to.emit(
            rpsContract,
            "MoveSubmitted",
          );
        }
        {
          const { handles, inputProof } = possibilities.Bob.ROCK;
          await expect(rpsContract.connect(signers.bob).play(handles[0], inputProof)).to.emit(
            rpsContract,
            "MoveSubmitted",
          );
        }
        {
          const { handles, inputProof } = possibilities.Alice.ROCK;
          await expect(rpsContract.connect(signers.alice).play(handles[0], inputProof)).to.be.revertedWith(
            "already made a move",
          );
        }
        {
          const { handles, inputProof } = possibilities.Bob.ROCK;
          await expect(rpsContract.connect(signers.bob).play(handles[0], inputProof)).to.be.revertedWith(
            "already made a move",
          );
        }
      });
      describe("When all moves submitted", () => {
        it("can not publish wrong results", async () => {
          const bothMovesFn = bothMoves(signers, rpsContract);
          await bothMovesFn(possibilities.Alice.ROCK, possibilities.Bob.SCISSORS);
          const encryptedState = (await rpsContract.readState())[0];
          const { abiEncodedClearValues, decryptionProof } = await fhevm.publicDecrypt([encryptedState]);

          await expect(rpsContract.computeResult(abiEncodedClearValues.slice(0, -1).concat("F"), decryptionProof)).to
            .reverted;
        });
        it("Alice plays 3 (Invalid), Bob plays ROCK (1)", async () => {
          // Alice plays 3 (Invalid), Bob plays ROCK (1)
          const getWinnerFn = getWinner(signers, rpsContract);
          const { winner } = await getWinnerFn(possibilities.Alice.ILLICIT_INPUT_1, possibilities.Bob.ROCK);
          // Alice's move (3) is not Rock(1), Paper(2), or Scissors(4).
          // Therefore, she fails the win check, and Bob wins by default.
          expect(winner).eq(signers.bob.address);
        });
        it("ILLICIT_2 uses digit 255 (Alice loses)", async () => {
          const getWinnerFn = getWinner(signers, rpsContract);
          const { winner } = await getWinnerFn(possibilities.Alice.ILLICIT_INPUT_2, possibilities.Bob.ROCK);

          // Alice played 7. Bob played 1. Bob wins.
          expect(winner).eq(signers.bob.address);
        });
      });
    });
  });
  describe("only one player", () => {
    beforeEach(async function () {
      // Check whether the tests are running against an FHEVM mock environment
      if (!fhevm.isMock) {
        console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
        this.skip();
      }

      ({ rpsContract, rpsContractAddress } = await deployFixture());
      possibilities = {
        Alice: {
          ROCK: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.alice.address)
            .add8(moveEnum.ROCK)
            .encrypt(),
          PAPER: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.alice.address)
            .add8(moveEnum.PAPER)
            .encrypt(),
          SCISSORS: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.alice.address)
            .add8(moveEnum.SCISSORS)
            .encrypt(),
          ILLICIT_INPUT_1: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.alice.address)
            .add8(3)
            .encrypt(),
          ILLICIT_INPUT_2: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.alice.address)
            .add8(255)
            .encrypt(),
          EMPTY_INPUT: await fhevm.createEncryptedInput(rpsContractAddress, signers.alice.address).add8(0).encrypt(),
        },
        Bob: {
          ROCK: await fhevm.createEncryptedInput(rpsContractAddress, signers.bob.address).add8(moveEnum.ROCK).encrypt(),
          PAPER: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.bob.address)
            .add8(moveEnum.PAPER)
            .encrypt(),
          SCISSORS: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.bob.address)
            .add8(moveEnum.SCISSORS)
            .encrypt(),
          ILLICIT_INPUT_1: await fhevm.createEncryptedInput(rpsContractAddress, signers.bob.address).add8(3).encrypt(),
          ILLICIT_INPUT_2: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.bob.address)
            .add8(255)
            .encrypt(),
          EMPTY_INPUT: await fhevm.createEncryptedInput(rpsContractAddress, signers.bob.address).add8(0).encrypt(),
        },
        Malfurion: {
          ROCK: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.malfurion.address)
            .add8(moveEnum.ROCK)
            .encrypt(),
          PAPER: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.malfurion.address)
            .add8(moveEnum.PAPER)
            .encrypt(),
          SCISSORS: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.malfurion.address)
            .add8(moveEnum.SCISSORS)
            .encrypt(),
          ILLICIT_INPUT_1: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.malfurion.address)
            .add8(3)
            .encrypt(),
          ILLICIT_INPUT_2: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.malfurion.address)
            .add8(255)
            .encrypt(),
          EMPTY_INPUT: await fhevm
            .createEncryptedInput(rpsContractAddress, signers.malfurion.address)
            .add8(0)
            .encrypt(),
        },
      };
      await rpsContract.initialize(signers.alice.address, ethers.ZeroAddress, ethers.ZeroAddress);
    });

    describe("happy path", () => {
      it("encrypted count should be uninitialized after deployment", async function () {
        const state = await rpsContract.readState();
        expect(state.gameState).to.eq(ethers.ZeroHash);
      });

      it("make move by player1 - paper", async function () {
        const { handles, inputProof } = possibilities.Alice.PAPER;
        await expect(rpsContract.connect(signers.alice).play(handles[0], inputProof)).to.emit(
          rpsContract,
          "MoveSubmitted",
        );
      });
      it("make move by player1 - scissors", async function () {
        const { handles, inputProof } = possibilities.Alice.SCISSORS;
        await expect(rpsContract.connect(signers.alice).play(handles[0], inputProof)).to.emit(
          rpsContract,
          "MoveSubmitted",
        );
      });
      it("make move by player1 - rock", async function () {
        const { handles, inputProof } = possibilities.Alice.ROCK;
        await expect(rpsContract.connect(signers.alice).play(handles[0], inputProof)).to.emit(
          rpsContract,
          "MoveSubmitted",
        );
      });
      describe("When all moves submitted", () => {
        it("can calculate results", async () => {
          {
            const { handles, inputProof } = possibilities.Alice.PAPER;
            await rpsContract.connect(signers.alice).play(handles[0], inputProof);
          }
          const encryptedState = (await rpsContract.readState())[0];
          const { abiEncodedClearValues, decryptionProof } = await fhevm.publicDecrypt([encryptedState]);

          await expect(rpsContract.computeResult(abiEncodedClearValues, decryptionProof)).to.emit(
            rpsContract,
            "ResultsPublished",
          );
        });
      });
    });
  });
});
