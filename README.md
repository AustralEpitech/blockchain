# Blockchain Exam Repository

Contains a full implementation of the ERC-4337 smart account & indexer exam.

## Structure

- **/contracts** – Smart contracts, Hardhat config, unit tests, deployment scripts.
- **/indexer** – Node.js backend for indexing EntryPoint events (UserOperationEvent,
  AccountDeployed, UserOperationRevertReason) with a REST/WS API.
- **/frontend** – React frontend for both account interaction flows and the
  live indexer feed.

Each subdirectory has more detailed README, setup steps and environment
variables.

---

## Quickstart (local development)

1. **Contracts**
   ```bash
   cd contracts
   npm install
   npx hardhat compile
   ```
2. **Indexer**
   ```bash
   cd indexer
   npm install
   cp .env.example .env
   # fill RPC_URL etc.
   npm run start        # starts HTTP+WS server on port 3001
   ```
3. **Frontend**
   ```bash
   cd frontend
   npm install
   cp .env.example .env
   # set REACT_APP_FACTORY_ADDRESS and BUNDLER_URL
   npm start            # runs app on http://localhost:3000
   ```

### Demo script (evaluator)

1. Deploy the patched contracts from `/contracts` and verify them on the target testnet.
   Use `SmartAccountFactory` plus `Counter`, then note the deployed addresses.
2. Start the indexer with `RPC_URL` pointed at the same network:
   ```bash
   cd indexer
   npm install
   cp .env.example .env
   npm start
   ```
3. Configure and start the frontend:
   ```bash
   cd frontend
   cp .env.example .env
   ```
   Fill in:
   ```bash
   REACT_APP_RPC_URL=...
   REACT_APP_FACTORY_ADDRESS=0x...
   REACT_APP_COUNTER_ADDRESS=0x...
   REACT_APP_BUNDLER_URL=...
   ```
   Then run:
   ```bash
   npm install
   npm start
   ```
4. Open `http://localhost:3000`, connect MetaMask in the **Owner Flow**, and keep the default or chosen salt.
5. Copy the displayed counterfactual address and prefund it with Sepolia ETH if no paymaster is configured.
6. Click **Deploy Smart Account**.
   This submits a UserOperation through the bundler with `initCode` set from the factory’s `createAccount(owner, salt)` call.
7. Click **Increment Counter as Owner** and verify the counter value refreshes.
8. Click **Generate Session Wallet** in the **Session Key Flow**. Its address is copied into the owner registration form.
9. In **Session Key Registration**, choose an expiry and click **Add Scoped Session Key**.
   The frontend registers the session key for `Counter.increment()` only.
10. In **Session Key Flow**, click **Increment Counter as Session Key**.
    This sends a bundler-routed UserOperation signed only by the generated session key.
11. Optionally try **Transfer ETH as Owner** to demonstrate that transfers remain owner-only and are not exposed in the session panel.
12. Watch the **Indexer Feed** update and open the resulting transactions in the explorer from the UI.

---

More detailed documentation is included in the subdirectory READMEs for each
component.
