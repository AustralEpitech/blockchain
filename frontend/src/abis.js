import { ethers } from 'ethers';

export const ZERO_ADDRESS = ethers.ZeroAddress;

export const factoryAbi = [
  'function getAddress(address owner, uint256 salt) view returns (address)',
  'function createAccount(address owner, uint256 salt) returns (address)',
];

export const accountAbi = [
  'function owner() view returns (address)',
  'function addSessionKey(address key, uint256 expiry, bytes4[] selectors)',
  'function revokeSessionKey(address key)',
  'function getSessionKey(address key) view returns (uint256 expiry, bytes4[] selectors, bool active)',
  'function execute(address target, uint256 value, bytes data)',
];

export const counterAbi = [
  'function increment()',
  'function getCount(address account) view returns (uint256)',
];

export const entryPointAbi = [
  'function getNonce(address sender, uint192 key) view returns (uint256)',
  'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)',
];
