require('dotenv').config();

import { WebhookClient, MessageEmbed } from 'discord.js';
import fs from 'fs';
import path from 'path';

const { WEBHOOK_ID, WEBHOOK_TOKEN, P2POOL_API_PATH } = process.env;
const DBFILE_PATH = path.join(__dirname, "db.json");

let client = new WebhookClient(WEBHOOK_ID as string, WEBHOOK_TOKEN as string, { disableMentions: 'everyone' });

// Check if env vars exist
[ 'WEBHOOK_ID', 'WEBHOOK_TOKEN', 'P2POOL_API_PATH' ].forEach(v => {
    if (!process.env[v]) {
        console.log(`Error: Environment variable '${v}' is not set`);
        process.exit(1);
    }
});

async function run() {
    let file: DbFile;
    try {
        let fileBuf = await fs.promises.readFile(DBFILE_PATH);
        file = JSON.parse(fileBuf.toString('utf-8'));
    } catch(e) {
        file = { blocksFound: 0 };
        await fs.promises.writeFile(DBFILE_PATH, JSON.stringify(file, null, 4));
    }

    try {
        let apiInfo: PoolInfo = JSON.parse(
            await (await fs.promises.readFile(
                path.join(P2POOL_API_PATH as string, "pool", "stats")))
                    .toString('utf-8')
        );
        let poolStats: PoolStats = JSON.parse(
            await (await fs.promises.readFile(
                path.join(P2POOL_API_PATH as string, "stats_mod")))
                    .toString('utf-8')
        );

        let totalBlocks = apiInfo.pool_statistics.totalBlocksFound;
        if (totalBlocks > file.blocksFound) {
            // p2pool instance might have changed
            file.blocksFound = totalBlocks;
        } else {
            while (totalBlocks < file.blocksFound) {
                totalBlocks++;

                console.log('Block found: ' + totalBlocks);

                let embed = new MessageEmbed()
                    .setTitle('New block found!')
                    .setDescription(`Block ${totalBlocks} has been found!`)
                    .setColor('#50b343');
                
                embed.addField('Blocks', JSON.stringify(poolStats.pool.blocks), false);

                embed.addField('Sidechain hashrate', `${Math.round((apiInfo.pool_statistics.hashRate / 10**6) * 10) / 10}mh/s`, true);
                embed.addField('Sidechain height', poolStats.network.height, true);
                embed.addField('Miners', poolStats.pool.miners, true);

                embed.setFooter(`Payout threshold: ${Number((poolStats.config.minPaymentThreshold * 10**-12).toFixed(15))} XMR`);

                client.send(embed)
                    .catch(console.error);
            }

            await fs.promises.writeFile(DBFILE_PATH, JSON.stringify({ blocksFound: apiInfo.pool_statistics.totalBlocksFound }, null, 4));
        }
    } catch(e) {
        console.error(e);
    }
}

console.log('Watching directory: ' + P2POOL_API_PATH);

setInterval(run, 2500);
run();

class DbFile {
    "blocksFound": number
}

class PoolInfo {
    "pool_list": string[];
    "pool_statistics": {
        "hashRate": number,
        "miners": number,
        "totalHashes": number,
        "lastBlockFoundTime": number,
        "lastBlockFound": number,
        "totalBlocksFound":number
    }
}

class PoolStats {
    "config": {
        "ports": {"port": number, "tls": boolean}[],
        "fee": number,
        "minPaymentThreshold": number
    };
    "network": {
        "height": number
    };
    "pool": {
        "stats": {
            "lastBlockFound": string
        }, "blocks": string[],
        "miners": number,
        "hashrate": number,
        "roundHashes": number
    }
}
