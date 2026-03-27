require('dotenv').config();
const { ethers } = require('ethers');
const express = require('express');
const WebSocket = require('ws');
const knex = require('knex');
const fs = require('fs');
const path = require('path');

// configuration
const RPC_URL = process.env.RPC_URL;
const ENTRYPOINT_ADDRESS = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
const START_BLOCK = parseInt(process.env.START_BLOCK || '0', 10);
const PORT = parseInt(process.env.PORT || '3001', 10);
const DB_PATH = process.env.DB_PATH || './data/indexer.sqlite';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);
const ZERO_ADDRESS = ethers.ZeroAddress;

if (!RPC_URL) {
  console.error('RPC_URL is not set');
  process.exit(1);
}

// initialize provider
const provider = new ethers.JsonRpcProvider(RPC_URL);

// contract interface
const entryPointAbi = [
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
  'event AccountDeployed(bytes32 indexed userOpHash, address indexed sender, address factory, address paymaster)',
  'event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)'
];
const entryPointContract = new ethers.Contract(ENTRYPOINT_ADDRESS, entryPointAbi, provider);

// initialize sqlite via knex
const db = knex({
  client: 'sqlite3',
  connection: {
    filename: DB_PATH,
  },
  useNullAsDefault: true,
});

async function initDb() {
  const dbDir = path.dirname(DB_PATH);
  fs.mkdirSync(dbDir, { recursive: true });

  await db.schema.hasTable('userops').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('userops', (table) => {
        table.increments('id').primary();
        table.string('userOpHash').index();
        table.string('sender').index();
        table.string('paymaster').index();
        table.bigInteger('nonce');
        table.boolean('success');
        table.string('actualGasCost');
        table.string('actualGasUsed');
        table.bigInteger('blockNumber');
        table.bigInteger('timestamp');
        table.string('blockHash');
        table.string('transactionHash');
      });
      return;
    }

    const hasTransactionHash = await db.schema.hasColumn('userops', 'transactionHash');
    if (!hasTransactionHash) {
      await db.schema.alterTable('userops', (table) => {
        table.string('transactionHash');
      });
    }
  });

  await db.schema.hasTable('account_deploys').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('account_deploys', (table) => {
        table.increments('id').primary();
        table.string('userOpHash').index();
        table.string('sender').index();
        table.string('factory');
        table.string('paymaster');
        table.bigInteger('blockNumber');
        table.bigInteger('timestamp');
        table.string('blockHash');
      });
    }
  });

  await db.schema.hasTable('reverts').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('reverts', (table) => {
        table.increments('id').primary();
        table.string('userOpHash').index();
        table.string('sender').index();
        table.bigInteger('nonce');
        table.text('revertReason');
        table.bigInteger('blockNumber');
        table.bigInteger('timestamp');
        table.string('blockHash');
      });
    }
  });
}

// simple WebSocket broadcaster
let wss;
function toJsonSafe(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(toJsonSafe);
  }

  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      out[key] = toJsonSafe(nestedValue);
    }
    return out;
  }

  return value;
}

function broadcast(msg) {
  if (!wss) return;
  const str = JSON.stringify(toJsonSafe(msg));
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(str);
    }
  });
}

async function insertIfMissing(tableName, uniqueWhere, row) {
  const existing = await db(tableName).where(uniqueWhere).first();
  if (existing) return false;
  await db(tableName).insert(row);
  return true;
}

async function processUserOpEvent(event) {
  const {
    userOpHash,
    sender,
    paymaster,
    nonce,
    success,
    actualGasCost,
    actualGasUsed,
  } = event.args;

  const block = await provider.getBlock(event.blockNumber);
  const existing = await db('userops')
    .where({ userOpHash, blockHash: event.blockHash })
    .first();

  if (existing) {
    if (!existing.transactionHash && event.transactionHash) {
      await db('userops')
        .where({ id: existing.id })
        .update({ transactionHash: event.transactionHash });
    }
    return;
  }

  const inserted = await insertIfMissing(
    'userops',
    { userOpHash, blockHash: event.blockHash },
    {
      userOpHash,
      sender,
      paymaster,
      nonce: nonce.toString(),
      success,
      actualGasCost: actualGasCost.toString(),
      actualGasUsed: actualGasUsed.toString(),
      blockNumber: event.blockNumber,
      timestamp: block.timestamp,
      blockHash: block.hash,
      transactionHash: event.transactionHash,
    }
  );

  if (inserted) {
    broadcast({
      type: 'UserOperationEvent',
      data: event.args,
      blockNumber: event.blockNumber,
      timestamp: block.timestamp,
      transactionHash: event.transactionHash,
    });
    console.log('indexed UserOperationEvent', event.args.userOpHash);
  }
}

async function processAccountDeployed(event) {
  const { userOpHash, sender, factory, paymaster } = event.args;

  const block = await provider.getBlock(event.blockNumber);
  const inserted = await insertIfMissing(
    'account_deploys',
    { userOpHash, blockHash: event.blockHash },
    {
      userOpHash,
      sender,
      factory,
      paymaster,
      blockNumber: event.blockNumber,
      timestamp: block.timestamp,
      blockHash: block.hash,
    }
  );

  if (inserted) {
    broadcast({
      type: 'AccountDeployed',
      data: event.args,
      blockNumber: event.blockNumber,
      timestamp: block.timestamp,
    });
    console.log('indexed AccountDeployed', event.args.userOpHash);
  }
}

async function processRevert(event) {
  const { userOpHash, sender, nonce, revertReason } = event.args;

  const block = await provider.getBlock(event.blockNumber);
  const inserted = await insertIfMissing(
    'reverts',
    { userOpHash, blockHash: event.blockHash },
    {
      userOpHash,
      sender,
      nonce: nonce.toString(),
      revertReason,
      blockNumber: event.blockNumber,
      timestamp: block.timestamp,
      blockHash: block.hash,
    }
  );

  if (inserted) {
    broadcast({
      type: 'UserOperationRevertReason',
      data: event.args,
      blockNumber: event.blockNumber,
      timestamp: block.timestamp,
    });
    console.log('indexed RevertReason', event.args.userOpHash);
  }
}

async function indexRange(fromBlock, toBlock) {
  if (fromBlock > toBlock) return;

  const userOpFilter = entryPointContract.filters.UserOperationEvent();
  const accountDeployedFilter = entryPointContract.filters.AccountDeployed();
  const revertFilter = entryPointContract.filters.UserOperationRevertReason();

  const [userOpEvents, accountDeployedEvents, revertEvents] = await Promise.all([
    entryPointContract.queryFilter(userOpFilter, fromBlock, toBlock),
    entryPointContract.queryFilter(accountDeployedFilter, fromBlock, toBlock),
    entryPointContract.queryFilter(revertFilter, fromBlock, toBlock),
  ]);

  for (const event of userOpEvents) {
    await processUserOpEvent(event);
  }

  for (const event of accountDeployedEvents) {
    await processAccountDeployed(event);
  }

  for (const event of revertEvents) {
    await processRevert(event);
  }
}

async function pollNewBlocks(startBlock) {
  let nextBlock = startBlock;

  while (true) {
    try {
      const latestBlock = await provider.getBlockNumber();
      if (nextBlock <= latestBlock) {
        await indexRange(nextBlock, latestBlock);
        nextBlock = latestBlock + 1;
      }
    } catch (e) {
      console.error('error polling blocks', e);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function main() {
  await initDb();

  const currentBlock = await provider.getBlockNumber();
  console.log('starting backfill from', START_BLOCK, 'to', currentBlock);

  for (let b = START_BLOCK; b <= currentBlock; b += 1000) {
    const to = Math.min(b + 999, currentBlock);
    await indexRange(b, to);
  }

  const nextBlock = currentBlock + 1;
  console.log('switching to polling from block', nextBlock, 'every', POLL_INTERVAL_MS, 'ms');
  void pollNewBlocks(nextBlock);

  const app = express();
  app.use(express.json());

  app.get('/events', async (req, res) => {
    const rows = await db('userops').orderBy('id', 'desc').limit(100);
    res.json(rows);
  });

  app.get('/deploys', async (req, res) => {
    const rows = await db('account_deploys').orderBy('id', 'desc').limit(100);
    res.json(rows);
  });

  app.get('/reverts', async (req, res) => {
    const rows = await db('reverts').orderBy('id', 'desc').limit(100);
    res.json(rows);
  });

  app.get('/stats', async (req, res) => {
    const total = await db('userops').count('* as cnt').first();
    const success = await db('userops').where('success', 1).count('* as cnt').first();
    const sponsored = await db('userops').whereNot('paymaster',
ZERO_ADDRESS).count('* as cnt').first();

    res.json({
      total: total.cnt,
      successRate: total.cnt ? (success.cnt / total.cnt) * 100 : 0,
      sponsoredRate: total.cnt ? (sponsored.cnt / total.cnt) * 100 : 0,
    });
  });

  const server = app.listen(PORT, () => {
    console.log('Indexer API running on port', PORT);
  });

  wss = new WebSocket.Server({ server });
  wss.on('connection', () => {
    console.log('ws client connected');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
