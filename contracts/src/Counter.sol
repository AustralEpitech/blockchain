// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Counter {
    mapping(address => uint256) public count;

    function increment() external {
        count[msg.sender]++;
    }

    function getCount(address account) external view returns (uint256) {
        return count[account];
    }
}
