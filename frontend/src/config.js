export const ENTRY_POINT_ADDRESS =
  process.env.REACT_APP_ENTRY_POINT_ADDRESS || '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
export const FACTORY_ADDRESS = process.env.REACT_APP_FACTORY_ADDRESS || '';
export const COUNTER_ADDRESS = process.env.REACT_APP_COUNTER_ADDRESS || '';
export const BUNDLER_URL = process.env.REACT_APP_BUNDLER_URL || '';
export const PUBLIC_RPC_URL = process.env.REACT_APP_RPC_URL || '';
export const INDEXER_URL = process.env.REACT_APP_INDEXER_URL || 'http://localhost:3001';
export const WS_URL =
  process.env.REACT_APP_INDEXER_WS_URL ||
  INDEXER_URL.replace(/^http/i, 'ws').replace(/\/$/, '');
export const ETHERSCAN_BASE_URL =
  process.env.REACT_APP_ETHERSCAN_BASE_URL || 'https://sepolia.etherscan.io';
