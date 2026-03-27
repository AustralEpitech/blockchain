// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";

import {SmartAccountFactory} from "../src/SmartAccountFactory.sol";
import {Counter} from "../src/Counter.sol";

contract DeploySepolia is Script {
    function run() external returns (SmartAccountFactory factory, Counter counter) {
        uint256 privKey = vm.envUint("PRIVATE_KEY");
        address entryPoint = vm.envAddress("ENTRY_POINT_ADDRESS");

        vm.startBroadcast(privKey);

        factory = new SmartAccountFactory(entryPoint);
        counter = new Counter();

        vm.stopBroadcast();

        console.log("Factory: ", address(factory));
        console.log("Counter: ", address(counter));
    }
}
