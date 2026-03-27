// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SmartAccount.sol";

contract SmartAccountFactory {
    address public immutable entryPoint;

    event AccountCreated(address indexed owner, address account, uint256 salt);

    constructor(address _entryPoint) {
        entryPoint = _entryPoint;
    }

    function createAccount(address owner, uint256 salt) public returns (address) {
        address addr = getAddress(owner, salt);
        if (addr.code.length == 0) {
            bytes memory bytecode = type(SmartAccount).creationCode;
            bytes memory initCode = abi.encodePacked(bytecode, abi.encode(owner, entryPoint));
            assembly {
                addr := create2(0, add(initCode, 0x20), mload(initCode), salt)
            }
            require(addr != address(0), "factory: create2 failed");
            emit AccountCreated(owner, addr, salt);
        }
        return addr;
    }

    function getAddress(address owner, uint256 salt) public view returns (address) {
        bytes memory bytecode = type(SmartAccount).creationCode;
        bytes memory initCode = abi.encodePacked(bytecode, abi.encode(owner, entryPoint));
        bytes32 hash = keccak256(initCode);
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            salt,
            hash
        )))));
    }
}
