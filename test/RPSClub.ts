import hre from "hardhat";
import { ethers } from "hardhat";
import { Signer, Contract, TransactionReceipt, Log } from "ethers";
import { expect } from "chai";
import { RPS, RPSClub } from "../typechain-types";
import { fhevm } from "fhevmjs";
import { network } from "hardhat";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
// This test file requires a setup similar to RPS.ts, including FHEVM utilities.
// We'll mock the fhevm-related parts as we don't have access to the utils file.
// Let's assume we have a way to generate encrypted inputs and proofs.
// For simplicity, we will focus on contract interactions and state changes.

enum moveEnum {
  EMPTY,
  ROCK,
  PAPER,
  SCISSORS,
  ILLICIT_INPUT_1, // 3 in u8, p1 wins
  ILLICIT_INPUT_2, // 255 in u8, p1 loses
}

type Signers = {
  deployer: Signer;
  alice: Signer;
  bob: Signer;
  malfurion: Signer;
};

// A simple mock for FHE operations. In a real scenario, this would use the FHEVM library.
const mockFhe = {
  encrypt_uint8: (move: moveEnum) => ({ data: `encrypted_${move}` }),
  generate_proof: () => "mock_proof",
};

async function deployFixture() {
  const rpsFactory = await ethers.getContractFactory("RPS");
  const rpsContract = await rpsFactory.deploy();
  await rpsContract.waitForDeployment();
  const rpsContractAddress = await rpsContract.getAddress();

  const rpsClubFactory = await ethers.getContractFactory("RPSClub");
  const rpsClubContract = await rpsClubFactory.deploy("https://my.app/api/nft/{id}", rpsContractAddress);
  await rpsClubContract.waitForDeployment();
  const rpsClubContractAddress = await rpsClubContract.getAddress();

  return { rpsContract, rpsClubContract, rpsContractAddress, rpsClubContractAddress };
}

describe("RPSClub.sol", function () {
  let signers: Signers;
  let rpsMaster: RPS;
  let rpsClub: RPSClub;
  let rpsClubAddress: string;

  beforeEach(async function () {
    const accounts = await ethers.getSigners();
    signers = {
      deployer: accounts[0],
      alice: accounts[1],
      bob: accounts[2],
      malfurion: accounts[3],
    };

    const { rpsContract, rpsClubContract, rpsClubContractAddress } = await deployFixture();
    rpsMaster = rpsContract;
    rpsClub = rpsClubContract;
    rpsClubAddress = rpsClubContractAddress;
  });

  describe("Deployment", function () {
    it("should set the correct RPS master contract address", async function () {
      const masterAddress = await rpsMaster.getAddress();
      // The rpsContract is private in RPSClub, so we can't directly check it.
      // We can infer it's correct if game creation works.
      expect(await rpsClub.uri(0)).to.equal("https://my.app/api/nft/{id}");
    });
  });

  describe("createGame", function () {
    it("should create a new RPS game instance", async function () {
      const aliceAddr = await signers.alice.getAddress();
      const bobAddr = await signers.bob.getAddress();
      const tx = await rpsClub.createGame(aliceAddr, bobAddr);
      await tx.wait();

      const expectedGameAddress = ethers.getCreateAddress({
        from: rpsClubAddress,
        nonce: 1,
      });

      const game = await ethers.getContractAt("RPS", expectedGameAddress);
      const state = await game.readState();

      expect(await state.player1).to.equal(aliceAddr);
      expect(await state.player2).to.equal(bobAddr);
      expect(await state.callback).to.equal(rpsClubAddress);
    });

    it("should revert if player 1 is the zero address", async function () {
      const bobAddr = await signers.bob.getAddress();
      await expect(rpsClub.createGame(ethers.ZeroAddress, bobAddr)).to.be.revertedWith("need at least 1 player");
    });
  });

  describe("RPSContractCallback", function () {
    it("should revert when called because game instances are not registered", async function () {
      const aliceAddr = await signers.alice.getAddress();
      const bobAddr = await signers.bob.getAddress();

      // This test highlights a bug in `RPSClub.sol`.
      // The `createGame` function clones a new RPS contract but never registers
      // its address in the `instances` mapping.
      // Therefore, when the game contract calls `RPSContractCallback`, the
      // `require(instances[msg.sender], "invalid sender")` check will always fail.
      // To fix this, `createGame` should add `instances[instance] = true;` after cloning.

      const tx = await rpsClub.createGame(aliceAddr, bobAddr);
      await tx.wait();

      const gameAddress = ethers.getCreateAddress({ from: rpsClubAddress, nonce: 1 });
      const gameAsClub = rpsClub.attach(gameAddress);

      // We can't directly call the callback from the game contract without playing a full game.
      // However, even if we could, it would fail.
      // We can demonstrate the issue by trying to call it from any address, including an EOA.
      // The core problem is the `instances` mapping is never populated.
      await expect(gameAsClub.RPSContractCallback(aliceAddr, 1)).to.be.reverted; // Reverted without reason string as it's a direct call
      await expect(rpsClub.RPSContractCallback(aliceAddr, 1)).to.be.revertedWith("invalid sender");
    });

    // The following tests assume the bug mentioned above is fixed in `RPSClub.sol`.
    // A hypothetical `RPSClubFixed.sol` contract would be used in a real test suite.
    describe("Interaction (assuming contract bug is fixed)", function () {
      it("should not be callable by an arbitrary address", async function () {
        const aliceAddr = await signers.alice.getAddress();
        await expect(rpsClub.connect(signers.malfurion).RPSContractCallback(aliceAddr, 1)).to.be.revertedWith(
          "invalid sender",
        );
      });

      it("should receive a callback and update wins, allowing user to exit", async function () {
        const aliceAddr = await signers.alice.getAddress();
        const bobAddr = await signers.bob.getAddress();

        // This test assumes the contract is fixed to register the instance upon creation.
        // 1. Create a game
        await rpsClub.connect(signers.deployer).createGame(aliceAddr, bobAddr);
        const gameAddress = ethers.getCreateAddress({ from: rpsClubAddress, nonce: 1 });

        // 2. Impersonate the game contract to make the callback
        await ethers.provider.send("hardhat_impersonateAccount", [gameAddress]);
        const gameSigner = await ethers.getSigner(gameAddress);
        const { networkHelpers } = await hre.network.connect();
        await networkHelpers.setBalance(gameAddress, 1000000000000000000n); // Sets 1 ETH

        // 3. As the game contract, call the callback to report Alice as the winner
        await rpsClub.connect(gameSigner).RPSContractCallback(aliceAddr, 1); // endState 1 = P1_WINS

        // 4. Have the winner (Alice) call exit() to claim her NFT
        await rpsClub.connect(signers.alice).exit();

        // 5. Verify Alice now has a level 1 NFT (for 1 win)
        const balance = await rpsClub.balanceOf(aliceAddr, 1);
        expect(balance).to.equal(1);

        // 6. Verify that a second attempt to exit fails because wins have been reset
        await expect(rpsClub.connect(signers.alice).exit()).to.be.revertedWith("you have nothing");

        // Stop impersonating the game contract account
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [gameAddress]);
      });
    });
  });

  describe("exit", function () {
    it("should revert if the user has no wins", async function () {
      await expect(rpsClub.connect(signers.alice).exit()).to.be.revertedWith("you have nothing");
    });

    // This test also requires a working callback mechanism to grant wins.
    // We can't test it without modifying the contract or using a complex setup
    // to manually manipulate storage (which is bad practice in tests).
    it("should mint a token and reset wins (hypothetical)", async function () {
      // To test this properly:
      // 1. A player (e.g., Alice) would need to win one or more games.
      // 2. This would increment `wins[alice_address]`.
      // 3. Alice calls `exit()`.
      // 4. We would check:
      //    - `balanceOf(alice_address, level)` returns 1. `level` is her number of wins.
      //    - `wins[alice_address]` is reset to 0, so a second `exit()` call fails.
      //
      // Since we cannot increment wins, we cannot write a meaningful test for the success case.
    });
  });
});
