# Sepolia Deployment

This repo now has a Foundry deployment scaffold for Sepolia:

- `script/DeploySepolia.s.sol`
- `.env.sepolia.example`

## 1. Prepare environment

Copy the env template and fill in real values:

```bash
cp .env.sepolia.example .env
```

Required variables:

- `SEPOLIA_RPC_URL`
- `PRIVATE_KEY`
- `ETHERSCAN_API_KEY`

## 2. Deploy to Sepolia

```bash
. .env && forge script script/DeploySepolia.s.sol:DeploySepolia \
    --rpc-url "$SEPOLIA_RPC_URL" \
    --broadcast \
    --verify \
    --etherscan-api-key "$ETHERSCAN_API_KEY"
```
