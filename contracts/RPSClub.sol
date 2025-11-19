// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {RPS, IResultCallback} from "./RPS.sol";

contract RPSClub is ERC1155, IResultCallback {
    RPS immutable rpsContract;
    using Clones for address;
    mapping(address => uint256) wins;
    mapping(address instances => bool registred) instances;
    event GameCreated(address indexed instance, address indexed player1, address indexed player2);

    constructor(string memory _uri, address _rps) ERC1155(_uri) {
        rpsContract = RPS(_rps);
    }

    function createGame(address p1, address p2) external {
        require(p1 != address(0), "need at least 1 player");
        address instance = address(rpsContract).clone();
        instances[instance] = true;
        RPS(instance).initialize(p1, p2, address(this));
        emit GameCreated(instance, p1, p2);
    }

    function RPSContractCallback(address winner, uint8 endState) external {
        require(instances[msg.sender], "invalid sender");
        wins[winner]++;
    }

    function exit() external {
        uint256 level = wins[msg.sender];
        wins[msg.sender] = 0;
        require(level > 0, "you have nothing");
        _mint(msg.sender, level, 1, "");
    }
}
