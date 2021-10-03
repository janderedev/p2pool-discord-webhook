# Monero P2Pool Discord Webhook

This program trigges a discord webhook whenever your [P2Pool](https://github.com/SChernykh/p2pool) node finds a block.

## Configuration
You need to start your p2pool node with the `--data-api` option set. This will make the node write its status to a directory, which this script reads from. \
Note that you need to point this to a directory, not a file.

Set the following environment variables:
```bash
P2POOL_API_PATH=/path/to/p2pool/json/api
WEBHOOK_ID=discord-webhook-id
WEBHOOK_TOKEN=discord-webhook-token
```

Install dependencies with `yarn`, then start the script with `yarn start`. \
Alternatively, you can use the bundled Dockerfile to run the script in docker.
