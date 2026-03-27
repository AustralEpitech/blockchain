import React, { useEffect, useState } from 'react';
import { ethers } from 'ethers';

import './App.css';
import { accountAbi, counterAbi, entryPointAbi, factoryAbi, ZERO_ADDRESS } from './abis';
import {
  BUNDLER_URL,
  COUNTER_ADDRESS,
  ENTRY_POINT_ADDRESS,
  ETHERSCAN_BASE_URL,
  FACTORY_ADDRESS,
  INDEXER_URL,
  PUBLIC_RPC_URL,
  WS_URL,
} from './config';
import {
  buildPackedUserOp,
  buildSessionDummySignature,
  buildSignedUserOperation,
  bundlerRequest,
  OWNER_DUMMY_SIGNATURE,
  sanitizeRpcUserOp,
  toQuantity,
  waitForUserOperationReceipt,
} from './lib/userOp';

const readProvider = PUBLIC_RPC_URL ? new ethers.JsonRpcProvider(PUBLIC_RPC_URL) : null;

const EMPTY_STATS = { total: 0, successRate: 0, sponsored: 0 };
const DEFAULT_SALT = '0';
const SESSION_INCREMENT_SELECTOR = '0xd09de08a';
const INITIAL_STATUS = 'Configure the factory, counter, bundler, and RPC endpoints to run the full demo.';

const counterInterface = new ethers.Interface(counterAbi);
const accountInterface = new ethers.Interface(accountAbi);
const factoryInterface = new ethers.Interface(factoryAbi);

function shortenValue(value, start = 10, end = 6) {
  if (!value || value.length <= start + end + 3) return value || '—';
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function normalizePercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeEvent(input) {
  const source = input?.type === 'UserOperationEvent' && input?.data ? input.data : input;
  if (!source) return null;

  return {
    id:
      input?.id ||
      `${source.userOpHash || 'unknown'}-${input?.blockNumber || source.blockNumber || '0'}-${
        input?.transactionHash || source.transactionHash || 'no-tx'
      }`,
    userOpHash: source.userOpHash || '—',
    sender: source.sender || '—',
    paymaster: source.paymaster || ZERO_ADDRESS,
    success: Boolean(source.success),
    actualGasCost: source.actualGasCost?.toString?.() || String(source.actualGasCost || '0'),
    blockNumber: Number(input?.blockNumber || source.blockNumber || 0),
    timestamp: Number(input?.timestamp || source.timestamp || 0),
    transactionHash: input?.transactionHash || source.transactionHash || '',
  };
}

function formatEtherDisplay(value) {
  try {
    return `${Number(ethers.formatEther(value || 0n)).toFixed(4)} ETH`;
  } catch {
    return '0 ETH';
  }
}

function formatGasCost(value) {
  if (!value) return '0 ETH';
  return `${(Number(value) / 1e18).toFixed(6)} ETH`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) return 'Pending';
  return new Date(timestamp * 1000).toLocaleString();
}

function formatSessionMeta(session) {
  if (!session) return null;

  return {
    active: session.active,
    expiryLabel: session.expiry ? new Date(Number(session.expiry) * 1000).toLocaleString() : '—',
    selectorsLabel:
      session.selectors && session.selectors.length > 0 ? session.selectors.join(', ') : 'All selectors',
  };
}

function parseDateTimeInput(value) {
  if (!value) return 0;
  return Math.floor(new Date(value).getTime() / 1000);
}

function isMissingContractRead(error) {
  return (
    error?.code === 'BAD_DATA' ||
    error?.code === 'CALL_EXCEPTION' ||
    error?.message?.includes('could not decode result data')
  );
}

function getInitialExpiryInput() {
  const oneHourOut = new Date(Date.now() + 60 * 60 * 1000);
  return new Date(oneHourOut.getTime() - oneHourOut.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function App() {
  const [browserProvider, setBrowserProvider] = useState(null);
  const [ownerSigner, setOwnerSigner] = useState(null);
  const [ownerAddress, setOwnerAddress] = useState('');
  const [chainId, setChainId] = useState('');
  const [salt, setSalt] = useState(DEFAULT_SALT);

  const [accountAddress, setAccountAddress] = useState('');
  const [counterfactualAddress, setCounterfactualAddress] = useState('');
  const [isDeployed, setIsDeployed] = useState(false);
  const [accountBalance, setAccountBalance] = useState('0 ETH');
  const [counterValue, setCounterValue] = useState('0');

  const [ownerTransferTarget, setOwnerTransferTarget] = useState('');
  const [ownerTransferAmount, setOwnerTransferAmount] = useState('');
  const [generatedSessionWallet, setGeneratedSessionWallet] = useState(null);
  const [sessionAddress, setSessionAddress] = useState('');
  const [expiryInput, setExpiryInput] = useState(getInitialExpiryInput);
  const [sessionMeta, setSessionMeta] = useState(null);

  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [feedStatus, setFeedStatus] = useState('Connecting…');
  const [feedError, setFeedError] = useState('');

  const [statusMessage, setStatusMessage] = useState(INITIAL_STATUS);
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState({
    connect: false,
    deploy: false,
    ownerIncrement: false,
    ownerTransfer: false,
    addSession: false,
    revokeSession: false,
    sessionIncrement: false,
    refresh: false,
    refreshSession: false,
  });

  const activeProvider = readProvider || browserProvider;
  const hasCounterConfig = Boolean(COUNTER_ADDRESS);
  const isOwnerConnected = Boolean(ownerSigner && ownerAddress);

  function setBusyFlag(key, value) {
    setBusy((current) => ({ ...current, [key]: value }));
  }

  function setMessage(message) {
    setStatusMessage(message);
    setErrorMessage('');
  }

  function setFailure(error) {
    setErrorMessage(error?.message || String(error));
  }

  async function runAction(key, action) {
    setBusyFlag(key, true);
    setErrorMessage('');

    try {
      await action();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusyFlag(key, false);
    }
  }

  async function refreshAccountState(nextAddress = accountAddress || counterfactualAddress, providerOverride = activeProvider) {
    if (!nextAddress || !providerOverride) return;

    const [code] = await Promise.all([
      providerOverride.getCode(nextAddress),
    ]);

    setAccountAddress(nextAddress);
    setIsDeployed(Boolean(code && code !== '0x'));

    if (!COUNTER_ADDRESS) {
      setCounterValue('Set REACT_APP_COUNTER_ADDRESS');
      return;
    }

    const counterCode = await providerOverride.getCode(COUNTER_ADDRESS);
    if (!counterCode || counterCode === '0x') {
      setCounterValue('Counter unavailable');
      throw new Error(
        `No contract was found at ${COUNTER_ADDRESS} on the active RPC network. Check REACT_APP_RPC_URL, MetaMask's selected chain, and REACT_APP_COUNTER_ADDRESS.`
      );
    }

    try {
      const counter = new ethers.Contract(COUNTER_ADDRESS, counterAbi, providerOverride);
      const count = await counter.getCount(nextAddress);
      setCounterValue(count.toString());
    } catch (error) {
      if (isMissingContractRead(error)) {
        setCounterValue('Counter unavailable');
        throw new Error(
          `The contract at ${COUNTER_ADDRESS} did not return data for getCount(address). This usually means the RPC network and contract address do not match, or the deployed contract ABI is different from the frontend ABI.`
        );
      }

      throw error;
    }
  }

  async function loadSessionMeta(keyAddress = sessionAddress, account = accountAddress, showLoading = false) {
    if (!keyAddress || !account || !activeProvider || !isDeployed) {
      setSessionMeta(null);
      return;
    }

    if (showLoading) setBusyFlag('refreshSession', true);

    try {
      const smartAccount = new ethers.Contract(account, accountAbi, activeProvider);
      const result = await smartAccount.getSessionKey(keyAddress);

      setSessionMeta(
        formatSessionMeta({
          expiry: result[0].toString(),
          selectors: result[1],
          active: result[2],
        })
      );
    } catch (error) {
      setSessionMeta(null);

      if (isMissingContractRead(error)) {
        throw new Error(
          `The smart account at ${account} did not return data for getSessionKey(address). This usually means the deployed contract does not expose the session-key read method expected by the frontend, or the account address points to a different contract version.`
        );
      }

      throw error;
    } finally {
      if (showLoading) setBusyFlag('refreshSession', false);
    }
  }

  function buildExecuteCall(target, value, data) {
    return accountInterface.encodeFunctionData('execute', [target, value, data]);
  }

  async function getFeeConfig(provider) {
    const feeData = await provider.getFeeData();
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits('2', 'gwei');
    const maxFeePerGas = feeData.maxFeePerGas || maxPriorityFeePerGas * 2n;
    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  async function signAndSendUserOperation({
    callData,
    includeFactory,
    mode,
    sessionWallet,
    accountAddressOverride,
    saltOverride,
    actionLabel = 'UserOperation',
  }) {
    if (!activeProvider) {
      throw new Error('No provider configured. Set REACT_APP_RPC_URL or connect MetaMask.');
    }
    if (!BUNDLER_URL) {
      throw new Error('Set REACT_APP_BUNDLER_URL before submitting UserOperations.');
    }
    if (!ENTRY_POINT_ADDRESS || !FACTORY_ADDRESS || !counterfactualAddress) {
      throw new Error('Factory, EntryPoint, or counterfactual address is missing.');
    }
    if (mode === 'owner' && !ownerSigner) {
      throw new Error('Connect the owner wallet first.');
    }
    if (mode === 'session' && !sessionWallet) {
      throw new Error('Generate or import a session wallet first.');
    }

    const deploySalt = BigInt(saltOverride ?? (salt || 0));
    const targetAccountAddress = accountAddressOverride || counterfactualAddress;
    const factoryData = factoryInterface.encodeFunctionData('createAccount', [ownerAddress, deploySalt]);
    const entryPoint = new ethers.Contract(ENTRY_POINT_ADDRESS, entryPointAbi, activeProvider);
    const { maxFeePerGas, maxPriorityFeePerGas } = await getFeeConfig(activeProvider);
    const estimateSignature =
      mode === 'owner' ? OWNER_DUMMY_SIGNATURE : buildSessionDummySignature(sessionWallet.address);
    const bundlerOptions = {
      onRequest: ({ method }) => {
        if (method === 'eth_estimateUserOperationGas') {
          setMessage(`${actionLabel}: requesting gas estimate from bundler...`);
        } else if (method === 'eth_sendUserOperation') {
          setMessage(`${actionLabel}: sending UserOperation to bundler...`);
        } else if (method === 'eth_getUserOperationReceipt') {
          setMessage(`${actionLabel}: waiting for bundler receipt...`);
        }
      },
    };

    let userOp = await buildSignedUserOperation({
      accountAddress: targetAccountAddress,
      callData,
      entryPointContract: entryPoint,
      estimateSignature,
      factoryAddress: FACTORY_ADDRESS,
      factoryData,
      includeFactory,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });

    const estimatedGas = await bundlerRequest(
      BUNDLER_URL,
      'eth_estimateUserOperationGas',
      [
        sanitizeRpcUserOp({
          sender: userOp.sender,
          nonce: toQuantity(userOp.nonce),
          factory: userOp.factory,
          factoryData: userOp.factoryData,
          callData: userOp.callData,
          callGasLimit: toQuantity(userOp.callGasLimit),
          verificationGasLimit: toQuantity(userOp.verificationGasLimit),
          preVerificationGas: toQuantity(userOp.preVerificationGas),
          maxFeePerGas: toQuantity(userOp.maxFeePerGas),
          maxPriorityFeePerGas: toQuantity(userOp.maxPriorityFeePerGas),
          paymasterData: '0x',
          signature: userOp.signature,
        }),
        ENTRY_POINT_ADDRESS,
      ],
      bundlerOptions
    );

    setMessage(`${actionLabel}: gas estimated. Waiting for signature...`);

    userOp = {
      ...userOp,
      callGasLimit: BigInt(estimatedGas.callGasLimit),
      verificationGasLimit: BigInt(estimatedGas.verificationGasLimit),
      preVerificationGas: BigInt(estimatedGas.preVerificationGas),
    };

    const userOpHash = await entryPoint.getUserOpHash(buildPackedUserOp(userOp));
    const rawSignature =
      mode === 'owner'
        ? await ownerSigner.signMessage(ethers.getBytes(userOpHash))
        : await sessionWallet.signMessage(ethers.getBytes(userOpHash));

    const signature =
      mode === 'owner'
        ? ethers.concat(['0x00', rawSignature])
        : ethers.concat(['0x01', sessionWallet.address, rawSignature]);

    const submittedUserOpHash = await bundlerRequest(
      BUNDLER_URL,
      'eth_sendUserOperation',
      [
        sanitizeRpcUserOp({
          sender: userOp.sender,
          nonce: toQuantity(userOp.nonce),
          factory: userOp.factory,
          factoryData: userOp.factoryData,
          callData: userOp.callData,
          callGasLimit: toQuantity(userOp.callGasLimit),
          verificationGasLimit: toQuantity(userOp.verificationGasLimit),
          preVerificationGas: toQuantity(userOp.preVerificationGas),
          maxFeePerGas: toQuantity(userOp.maxFeePerGas),
          maxPriorityFeePerGas: toQuantity(userOp.maxPriorityFeePerGas),
          paymasterData: '0x',
          signature,
        }),
        ENTRY_POINT_ADDRESS,
      ],
      bundlerOptions
    );

    setMessage(`${actionLabel}: submitted (${shortenValue(submittedUserOpHash)}). Waiting for receipt...`);

    const receipt = await waitForUserOperationReceipt(BUNDLER_URL, submittedUserOpHash, 90000, bundlerOptions);
    if (!receipt) {
      throw new Error(
        `${actionLabel} was submitted but no receipt arrived within 90 seconds. The bundler may still be processing it, or the smart-account address may need prefunding for deployment gas. UserOp hash: ${submittedUserOpHash}`
      );
    }
    await refreshAccountState(targetAccountAddress);
    return { receipt, userOpHash: submittedUserOpHash };
  }

  async function resolveDeployTarget() {
    if (!activeProvider || !ownerAddress || !FACTORY_ADDRESS) {
      throw new Error('Connect the owner wallet and configure the factory before deploying.');
    }

    const factory = new ethers.Contract(FACTORY_ADDRESS, factoryAbi, activeProvider);
    let nextSalt = BigInt(salt || 0);
    let nextAddress = await factory.getAddress(ownerAddress, nextSalt);
    let code = await activeProvider.getCode(nextAddress);

    while (code && code !== '0x') {
      nextSalt += 1n;
      nextAddress = await factory.getAddress(ownerAddress, nextSalt);
      code = await activeProvider.getCode(nextAddress);
    }

    return { address: nextAddress, salt: nextSalt };
  }

  useEffect(() => {
    if (!window.ethereum) return undefined;

    const provider = new ethers.BrowserProvider(window.ethereum);
    setBrowserProvider(provider);

    let mounted = true;

    window.ethereum
      .request({ method: 'eth_chainId' })
      .then((nextChainId) => {
        if (mounted) setChainId(nextChainId);
      })
      .catch(() => {
        if (mounted) setChainId('');
      });

    const handleChainChanged = (nextChainId) => {
      if (mounted) setChainId(nextChainId);
    };

    window.ethereum.on?.('chainChanged', handleChainChanged);

    return () => {
      mounted = false;
      window.ethereum.removeListener?.('chainChanged', handleChainChanged);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function bootstrapFeed() {
      try {
        const [eventsResponse, statsResponse] = await Promise.all([
          fetch(`${INDEXER_URL}/events`),
          fetch(`${INDEXER_URL}/stats`),
        ]);
        const [eventsPayload, statsPayload] = await Promise.all([eventsResponse.json(), statsResponse.json()]);

        if (!mounted) return;

        setEvents((eventsPayload || []).map(normalizeEvent).filter(Boolean));
        setStats({
          total: Number(statsPayload?.total || 0),
          successRate: normalizePercent(statsPayload?.successRate),
          sponsored: normalizePercent(statsPayload?.sponsoredRate),
        });
        setFeedError('');
      } catch {
        if (mounted) setFeedError('Unable to load indexer data.');
      }
    }

    bootstrapFeed();

    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      if (!mounted) return;
      setFeedStatus('Live');
      setFeedError('');
    };

    socket.onmessage = (message) => {
      if (!mounted) return;

      try {
        const parsed = JSON.parse(message.data);
        if (parsed.type !== 'UserOperationEvent') return;

        const incomingEvent = normalizeEvent(parsed);
        if (!incomingEvent) return;

        setEvents((current) => {
          const deduped = current.filter(
            (event) =>
              !(event.userOpHash === incomingEvent.userOpHash && event.blockNumber === incomingEvent.blockNumber)
          );
          return [incomingEvent, ...deduped].slice(0, 100);
        });

        setStats((current) => {
          const total = current.total + 1;
          const successCount = (current.successRate / 100) * current.total + (incomingEvent.success ? 1 : 0);
          const sponsoredCount =
            (current.sponsored / 100) * current.total + (incomingEvent.paymaster !== ZERO_ADDRESS ? 1 : 0);

          return {
            total,
            successRate: total ? (successCount / total) * 100 : 0,
            sponsored: total ? (sponsoredCount / total) * 100 : 0,
          };
        });
      } catch {
        setFeedError('Received an unreadable websocket payload.');
      }
    };

    socket.onerror = () => {
      if (!mounted) return;
      setFeedStatus('Disconnected');
      setFeedError('Websocket connection to the indexer failed.');
    };

    socket.onclose = () => {
      if (mounted) setFeedStatus('Disconnected');
    };

    return () => {
      mounted = false;
      socket.close();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function computeAddress() {
      if (!ownerAddress || !FACTORY_ADDRESS || !activeProvider) {
        setCounterfactualAddress('');
        setAccountAddress('');
        setIsDeployed(false);
        setSessionMeta(null);
        return;
      }

      try {
        const factory = new ethers.Contract(FACTORY_ADDRESS, factoryAbi, activeProvider);
        const derivedAddress = await factory.getAddress(ownerAddress, BigInt(salt || 0));

        if (cancelled) return;

        setCounterfactualAddress(derivedAddress);
        await refreshAccountState(derivedAddress, activeProvider);
      } catch (error) {
        if (!cancelled) setFailure(error);
      }
    }

    void computeAddress();

    return () => {
      cancelled = true;
    };
  }, [activeProvider, ownerAddress, salt]);

  useEffect(() => {
    if (generatedSessionWallet?.address) {
      setSessionAddress(generatedSessionWallet.address);
    }
  }, [generatedSessionWallet]);

  async function connectOwnerWallet() {
    await runAction('connect', async () => {
      if (!window.ethereum) {
        throw new Error('MetaMask is required for the owner flow.');
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      const signer = await provider.getSigner();

      setBrowserProvider(provider);
      setOwnerSigner(signer);
      setOwnerAddress(await signer.getAddress());
      setChainId(await window.ethereum.request({ method: 'eth_chainId' }));
      setMessage('Owner wallet connected. The frontend will now derive the counterfactual address from the selected salt.');
    });
  }

  async function handleRefresh() {
    await runAction('refresh', async () => {
      await refreshAccountState();
      setMessage('Account state refreshed.');
    });
  }

  async function deploySmartAccount() {
    await runAction('deploy', async () => {
      setMessage('Deploy: finding the next available smart-account address...');
      const { address: deployAddress, salt: deploySalt } = await resolveDeployTarget();
      setMessage(`Deploy: using salt ${deploySalt.toString()} for ${shortenValue(deployAddress)}. Building UserOperation...`);
      const result = await signAndSendUserOperation({
        callData: buildExecuteCall(ownerAddress, 0n, '0x'),
        includeFactory: true,
        accountAddressOverride: deployAddress,
        mode: 'owner',
        saltOverride: deploySalt,
        actionLabel: 'Deploy',
      });
      if (deploySalt.toString() !== salt) {
        setSalt(deploySalt.toString());
      }

      setMessage(
        `Deploy UserOp submitted for ${shortenValue(deployAddress)} using salt ${deploySalt.toString()}.${result.receipt?.receipt?.transactionHash ? ` Tx: ${shortenValue(result.receipt.receipt.transactionHash)}` : ''}`
      );
    });
  }

  async function submitOwnerIncrement() {
    if (!COUNTER_ADDRESS) {
      setFailure(new Error('Set REACT_APP_COUNTER_ADDRESS before using the counter demo.'));
      return;
    }

    await runAction('ownerIncrement', async () => {
      const result = await signAndSendUserOperation({
        callData: buildExecuteCall(COUNTER_ADDRESS, 0n, counterInterface.encodeFunctionData('increment')),
        includeFactory: !isDeployed,
        mode: 'owner',
      });

      setMessage(
        `Owner increment submitted.${result.receipt?.receipt?.transactionHash ? ` Tx: ${shortenValue(result.receipt.receipt.transactionHash)}` : ''}`
      );
    });
  }

  async function addSessionKey() {
    await runAction('addSession', async () => {
      if (!ownerSigner || !accountAddress) {
        throw new Error('Deploy the smart account and connect the owner wallet first.');
      }

      const expiry = parseDateTimeInput(expiryInput);
      if (!sessionAddress) throw new Error('Provide a session key address first.');
      if (!expiry) throw new Error('Choose a valid expiry timestamp.');

      const account = new ethers.Contract(accountAddress, accountAbi, ownerSigner);
      const tx = await account.addSessionKey(sessionAddress, expiry, [SESSION_INCREMENT_SELECTOR]);
      await tx.wait();

      await loadSessionMeta(sessionAddress, accountAddress);
      setMessage(`Session key registered for ${shortenValue(sessionAddress)} with increment-only scope.`);
    });
  }

  async function revokeSessionKey() {
    await runAction('revokeSession', async () => {
      if (!ownerSigner || !accountAddress || !sessionAddress) {
        throw new Error('Provide a registered session key address first.');
      }

      const account = new ethers.Contract(accountAddress, accountAbi, ownerSigner);
      const tx = await account.revokeSessionKey(sessionAddress);
      await tx.wait();

      await loadSessionMeta(sessionAddress, accountAddress);
      setMessage(`Session key revoked for ${shortenValue(sessionAddress)}.`);
    });
  }

  function generateSessionWallet() {
    const wallet = ethers.Wallet.createRandom();
    setGeneratedSessionWallet(wallet);
    setMessage('A new in-browser session wallet was generated. Register its address from the owner section before using it.');
  }

  async function refreshSessionStatus() {
    await runAction('refreshSession', async () => {
      await loadSessionMeta(generatedSessionWallet?.address, accountAddress);
      setMessage('Session status refreshed.');
    });
  }

  async function submitSessionIncrement() {
    if (!generatedSessionWallet) {
      setFailure(new Error('Generate a session wallet first.'));
      return;
    }
    if (!COUNTER_ADDRESS) {
      setFailure(new Error('Set REACT_APP_COUNTER_ADDRESS before using the counter demo.'));
      return;
    }

    await runAction('sessionIncrement', async () => {
      const result = await signAndSendUserOperation({
        callData: buildExecuteCall(COUNTER_ADDRESS, 0n, counterInterface.encodeFunctionData('increment')),
        includeFactory: false,
        mode: 'session',
        sessionWallet: generatedSessionWallet,
      });

      await loadSessionMeta(generatedSessionWallet.address, accountAddress);
      setMessage(
        `Session key increment submitted.${result.receipt?.receipt?.transactionHash ? ` Tx: ${shortenValue(result.receipt.receipt.transactionHash)}` : ''}`
      );
    });
  }

  function openTransaction(transactionHash) {
    if (!transactionHash) return;
    window.open(`${ETHERSCAN_BASE_URL}/tx/${transactionHash}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        <header className="hero">
          <div className="config-card">
            <InfoRow label="Factory" value={FACTORY_ADDRESS || 'Missing config'} />
            <InfoRow label="EntryPoint" value={ENTRY_POINT_ADDRESS} />
          </div>
          <div className="config-card">
            <InfoRow label="Bundler" value={BUNDLER_URL || 'Missing config'} />
            <InfoRow label="Public RPC" value={PUBLIC_RPC_URL || 'Using MetaMask provider only'} />
          </div>
        </header>

        {statusMessage ? <div className="banner banner-success">{statusMessage}</div> : null}
        {errorMessage ? <div className="banner banner-error">{errorMessage}</div> : null}

        <section className="grid two-up">
          <section className="card">
            <div className="card-header">
              <div>
                <h2>Owner flow</h2>
                <p>Connect the owner, derive the CREATE2 address, deploy, and send owner-signed UserOperations.</p>
              </div>
            </div>

            <div className="field-grid">
              <Field label="Salt">
                <input value={salt} onChange={(event) => setSalt(event.target.value)} />
              </Field>
              <Field label="Owner EOA">
                <input readOnly value={ownerAddress || 'Connect MetaMask to continue'} />
              </Field>
            </div>

            <div className="actions">
              <button onClick={connectOwnerWallet} disabled={busy.connect}>
                {busy.connect ? 'Connecting…' : isOwnerConnected ? 'Reconnect Owner Wallet' : 'Connect Owner Wallet'}
              </button>
              <button className="button-secondary" onClick={deploySmartAccount} disabled={!isOwnerConnected || busy.deploy}>
                {busy.deploy ? 'Submitting Deploy…' : 'Deploy Smart Account'}
              </button>
              <button className="button-ghost" onClick={handleRefresh} disabled={!counterfactualAddress || busy.refresh}>
                {busy.refresh ? 'Refreshing…' : 'Refresh State'}
              </button>
            </div>

            <div className="note">
              Deploy uses <code>factory.getAddress(owner, salt)</code> and an <code>initCode</code>-backed UserOperation.
              If no paymaster is configured, prefund the counterfactual address before the first UserOp.
            </div>

            <div className="info-list">
              <InfoRow label="Counterfactual address" value={counterfactualAddress || '—'} />
              <InfoRow label="Deployment status" value={isDeployed ? 'Deployed' : 'Not deployed yet'} />
              <InfoRow label="Active smart account" value={accountAddress || '—'} />
              <InfoRow label="Counter value" value={hasCounterConfig ? counterValue : 'Set REACT_APP_COUNTER_ADDRESS'} />
              <InfoRow label="Chain ID" value={chainId || '—'} />
            </div>

            <h3>Owner UserOps</h3>
            <div className="actions">
              <button onClick={submitOwnerIncrement} disabled={!hasCounterConfig || !counterfactualAddress || busy.ownerIncrement}>
                {busy.ownerIncrement ? 'Submitting Increment…' : 'Increment Counter as Owner'}
              </button>
            </div>

            <h3>Session key registration</h3>
            <div className="field-grid">
              <Field label="Session key address">
                <input value={sessionAddress} onChange={(event) => setSessionAddress(event.target.value)} />
              </Field>
              <Field label="Expiry">
                <input type="datetime-local" value={expiryInput} onChange={(event) => setExpiryInput(event.target.value)} />
              </Field>
            </div>

            <div className="actions">
              <button onClick={addSessionKey} disabled={!sessionAddress || !isDeployed || busy.addSession}>
                {busy.addSession ? 'Adding Session Key…' : 'Add Scoped Session Key'}
              </button>
              <button className="button-ghost" onClick={revokeSessionKey} disabled={!sessionAddress || !isDeployed || busy.revokeSession}>
                {busy.revokeSession ? 'Revoking…' : 'Revoke Session Key'}
              </button>
            </div>

            {sessionMeta ? (
              <div className="info-list">
                <InfoRow label="Session active" value={sessionMeta.active ? 'Yes' : 'No'} />
                <InfoRow label="Registered expiry" value={sessionMeta.expiryLabel} />
                <InfoRow label="Selectors" value={sessionMeta.selectorsLabel} />
              </div>
            ) : null}
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <h2>Session flow</h2>
                <p>Generate an in-browser keypair and submit the scoped increment UserOperation without the owner signature.</p>
              </div>
            </div>

            <div className="actions">
              <button onClick={generateSessionWallet}>
                {generatedSessionWallet ? 'Regenerate Session Wallet' : 'Generate Session Wallet'}
              </button>
              <button
                className="button-ghost"
                onClick={refreshSessionStatus}
                disabled={!generatedSessionWallet || !accountAddress || busy.refreshSession}
              >
                {busy.refreshSession ? 'Refreshing…' : 'Refresh Session Status'}
              </button>
            </div>

            <div className="info-list">
              <InfoRow label="Generated address" value={generatedSessionWallet?.address || '—'} />
              <InfoRow label="Private key" value={generatedSessionWallet?.privateKey || 'Generate locally in browser'} />
              <InfoRow label="Smart account" value={accountAddress || '—'} />
            </div>

            <div className="actions">
              <button
                onClick={submitSessionIncrement}
                disabled={!generatedSessionWallet || !hasCounterConfig || !isDeployed || busy.sessionIncrement}
              >
                {busy.sessionIncrement ? 'Submitting Session UserOp…' : 'Increment Counter as Session Key'}
              </button>
            </div>

            {sessionMeta ? (
              <div className="info-list">
                <InfoRow label="Session active" value={sessionMeta.active ? 'Yes' : 'No'} />
                <InfoRow label="Expiry" value={sessionMeta.expiryLabel} />
                <InfoRow label="Selectors" value={sessionMeta.selectorsLabel} />
              </div>
            ) : null}
          </section>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2>Indexer feed</h2>
              <p>Live <code>UserOperationEvent</code> rows from the backend indexer.</p>
            </div>
            <span className={`status-pill ${feedStatus === 'Live' ? 'status-live' : ''}`}>{feedStatus}</span>
          </div>

          <div className="stats-grid">
            <div className="stat">
              <strong>{stats.total}</strong>
              <span>Total indexed</span>
            </div>
            <div className="stat">
              <strong>{stats.successRate.toFixed(1)}%</strong>
              <span>Success rate</span>
            </div>
            <div className="stat">
              <strong>{stats.sponsored.toFixed(1)}%</strong>
              <span>Sponsored</span>
            </div>
          </div>

          {feedError ? <div className="feed-error">{feedError}</div> : null}

          <div className="feed-list">
            {events.length === 0 ? (
              <div className="empty-state">No indexed UserOperations yet.</div>
            ) : (
              events.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className="feed-item"
                  onClick={() => openTransaction(event.transactionHash)}
                  disabled={!event.transactionHash}
                >
                  <div className="feed-item-top">
                    <div>
                      <div className="feed-label">UserOp</div>
                      <div className="mono">{shortenValue(event.userOpHash, 18, 10)}</div>
                    </div>
                    <span className={`status-pill ${event.success ? 'status-live' : 'status-failed'}`}>
                      {event.success ? 'Success' : 'Failed'}
                    </span>
                  </div>

                  <div className="feed-grid">
                    <InfoRow label="Sender" value={shortenValue(event.sender)} />
                    <InfoRow label="Paymaster" value={event.paymaster ? shortenValue(event.paymaster) : 'None'} />
                    <InfoRow label="Gas cost" value={formatGasCost(event.actualGasCost)} />
                    <InfoRow label="Block" value={event.blockNumber || '—'} />
                    <InfoRow label="Timestamp" value={formatTimestamp(event.timestamp)} />
                    <InfoRow label="Explorer" value={ETHERSCAN_BASE_URL.replace(/^https?:\/\//, '')} />
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
