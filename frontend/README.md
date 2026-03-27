# Frontend

React application for:

- ERC-4337 smart account deployment from an owner EOA
- Owner-signed UserOperations through a bundler
- Session-key registration and scoped session-key UserOperations
- Live `UserOperationEvent` feed from the indexer

## Configuration

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Required values:

```bash
REACT_APP_RPC_URL=https://sepolia-rpc.example
REACT_APP_FACTORY_ADDRESS=0x...
REACT_APP_COUNTER_ADDRESS=0x...
REACT_APP_BUNDLER_URL=https://bundler.example.com
```

Optional values:

```bash
REACT_APP_ENTRY_POINT_ADDRESS=0x0000000071727De22E5E9d8BAf0edAc6f37da032
REACT_APP_INDEXER_URL=http://localhost:3001
REACT_APP_INDEXER_WS_URL=ws://localhost:3001
REACT_APP_ETHERSCAN_BASE_URL=https://sepolia.etherscan.io
```

## Run

```bash
cd frontend
npm install
npm start
```

## What The UI Covers

1. **Owner Flow**
   Computes the deterministic smart-account address from `factory.getAddress(owner, salt)`, submits the deploy UserOperation with `initCode`, sends an owner-signed `increment()` UserOperation, and sends an owner-only ETH transfer UserOperation.
2. **Session Key Registration**
   Registers or revokes a session key from the owner wallet with a chosen expiry. This frontend scopes the session key to `Counter.increment()` only.
3. **Session Key Flow**
   Generates an in-browser keypair and uses it to sign and submit a session-key UserOperation through the bundler without the owner signature.
4. **State Refresh**
   Shows smart-account deployment status, native balance, counter value, and session registration metadata.
5. **Indexer Feed**
   Streams indexed `UserOperationEvent` rows from the backend.

## Notes

- Without a paymaster, the counterfactual smart-account address must be prefunded before the first deploy UserOperation so `validateUserOp` can cover `missingAccountFunds`.
- The session-key path is intentionally narrower than the owner path: only `Counter.increment()` is exposed in the UI.
- The current demo assumes the patched `SmartAccount.sol` in this repo has been redeployed.
