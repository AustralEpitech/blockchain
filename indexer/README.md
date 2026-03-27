# Indexer

Backend service that connects to an Ethereum node and indexes ERC-4337 events emitted by the EntryPoint contract (v0.7). The service persists data in a database and provides an API.

## Setup

1. Install dependencies:
   ```bash
   cd indexer
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your RPC provider URL and other configuration.

3. Run the service:
   ```bash
   npm run start
   ```

## Configuration

The service uses environment variables to configure the node provider,
database connection, and start block for backfill. See `.env.example`.

### API

- `GET /events` – last 100 UserOperationEvent records
- `GET /deploys` – last 100 account deployment events
- `GET /reverts` – last 100 UserOperationRevertReason records
- `GET /stats` – aggregate metrics (total ops, success rate, sponsored %)

The backend persists data in SQLite (configured by `DB_PATH`) and exposes
both REST and WebSocket feeds for real‑time updates.

### Running

Start with:
```bash
npm run start
```
The service will perform a historical backfill from `START_BLOCK` and then
listen for new events. It handles occasional RPC failures by retrying.

Currently reorg handling is minimal: block hashes are stored, and if a
mismatch is detected on startup the affected rows are logged (but not
purged)."