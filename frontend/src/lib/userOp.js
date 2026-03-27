import { ethers } from 'ethers';

export const OWNER_DUMMY_SIGNATURE = `0x00${'11'.repeat(65)}`;

export function buildSessionDummySignature(sessionKeyAddress) {
  const paddedAddress = sessionKeyAddress ? sessionKeyAddress.slice(2).padStart(40, '0') : '00'.repeat(20);
  return `0x01${paddedAddress}${'11'.repeat(65)}`;
}

export function toQuantity(value) {
  return ethers.toQuantity(BigInt(value));
}

function padUint128(value) {
  return ethers.zeroPadValue(ethers.toBeHex(BigInt(value)), 16);
}

export function packTwoUint128(first, second) {
  return ethers.concat([padUint128(first), padUint128(second)]);
}

export function buildInitCode(factoryAddress, factoryData) {
  if (!factoryAddress || !factoryData || factoryData === '0x') {
    return '0x';
  }
  return ethers.concat([factoryAddress, factoryData]);
}

export function buildPackedUserOp(userOp) {
  return {
    sender: userOp.sender,
    nonce: BigInt(userOp.nonce),
    initCode: buildInitCode(userOp.factory, userOp.factoryData),
    callData: userOp.callData,
    accountGasLimits: packTwoUint128(userOp.verificationGasLimit, userOp.callGasLimit),
    preVerificationGas: BigInt(userOp.preVerificationGas),
    gasFees: packTwoUint128(userOp.maxPriorityFeePerGas, userOp.maxFeePerGas),
    paymasterAndData: '0x',
    signature: userOp.signature,
  };
}

export function sanitizeRpcUserOp(userOp) {
  const sanitized = {};

  Object.entries(userOp).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    sanitized[key] = value;
  });

  return sanitized;
}

export async function bundlerRequest(url, method, params, options = {}) {
  const { onRequest, onResponse } = options;
  onRequest?.({ method, params });
  if (typeof window !== 'undefined') {
    console.info('[bundler rpc request]', method, params);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
  });

  const payload = await response.json();

  if (!response.ok || payload.error) {
    const message = payload.error?.message || `Bundler request failed: ${response.status}`;
    if (typeof window !== 'undefined') {
      console.error('[bundler rpc error]', method, payload.error || message);
    }
    throw new Error(message);
  }

  onResponse?.({ method, result: payload.result });
  if (typeof window !== 'undefined') {
    console.info('[bundler rpc response]', method, payload.result);
  }

  return payload.result;
}

export async function waitForUserOperationReceipt(bundlerUrl, userOpHash, timeoutMs = 90000, options = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await bundlerRequest(
      bundlerUrl,
      'eth_getUserOperationReceipt',
      [userOpHash],
      options
    ).catch(() => null);
    if (receipt) {
      return receipt;
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 3000);
    });
  }

  return null;
}

export async function buildSignedUserOperation({
  accountAddress,
  callData,
  entryPointContract,
  estimateSignature,
  factoryAddress,
  factoryData,
  includeFactory,
  maxFeePerGas,
  maxPriorityFeePerGas,
}) {
  const nonce = await entryPointContract.getNonce(accountAddress, 0);
  const baseUserOp = {
    sender: accountAddress,
    nonce,
    factory: includeFactory ? factoryAddress : undefined,
    factoryData: includeFactory ? factoryData : undefined,
    callData,
    callGasLimit: 250000n,
    verificationGasLimit: includeFactory ? 500000n : 250000n,
    preVerificationGas: 80000n,
    maxFeePerGas,
    maxPriorityFeePerGas,
    signature: estimateSignature,
  };

  return baseUserOp;
}
