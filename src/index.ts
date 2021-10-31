require('dotenv').config();

import axios from 'axios';
import { WebhookClient, MessageEmbed } from 'discord.js';
import fs from 'fs';
import path from 'path';

const { WEBHOOK_ID, WEBHOOK_TOKEN, P2POOL_API_PATH } = process.env;
const DBFILE_PATH = path.join(__dirname, "..", "db.json");

let client = new WebhookClient(WEBHOOK_ID as string, WEBHOOK_TOKEN as string, { disableMentions: 'everyone' });

// Check if env vars exist
[ 'WEBHOOK_ID', 'WEBHOOK_TOKEN' ].forEach(v => {
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
        while (totalBlocks > file.blocksFound) {
            file.blocksFound++;
        
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

        await fs.promises.writeFile(DBFILE_PATH, JSON.stringify(file, null, 4));
    } catch(e) {
        console.error(e);
    }
}

if (process.env['DISABLE_BLOCK_NOTIFS'] == 'true') {
    console.log('Info: Block notifications are disabled');
} else {
    if (!P2POOL_API_PATH) throw '$P2POOL_API_PATH not set';

    console.log('Watching directory: ' + P2POOL_API_PATH);

    setInterval(run, 2500);
    run();
}

if (process.env['WALLET_ADDRESS'] && process.env['XMRVSBEAST_TOKEN']) {
    let INVALID_CREDS = false;

    const address = process.env['WALLET_ADDRESS'] as string;
    const token = process.env['XMRVSBEAST_TOKEN'] as string;
    let run_xmrvsbeast = async () => {
        /**
         * xmrvsbeast's way of loading bonus raffle info is "designed" in the stupidest way imaginable:
         * The actual history data is stored at xmrvsbeast.com/p2pool/history_logs/{first 8 letters of wallet address}.txt,
         * but that file is only accessible WHILE xmrvsbeast.com/cgi-bin/p2pool_bonus_history.cgi?address={wallet}&token={token}
         * IS BEING LOADED.
         * This means we first have to start loading that URL, THEN we can start loading the history logs.
         * 
         * I can't wait to see all of this break in a few weeks lol
         */

        if (INVALID_CREDS) return;

        try {
            let req = await axios.get(`httos://xmrvsbeast.com/cgi-bin/p2pool_bonus_history.cgi`
                              + `?address=${address}`
                              + `&token=${token}`,
                {
                    headers: { 'User-Agent': `https://github.com/janderedev/p2pool-discord-webhook` },
                    responseType: 'stream',
                });

            req.data.on('data', async (data: Buffer) => {
                let str = data.toString('utf8');
                //console.debug(str);

                if (str.includes('Invalid Wallet Address') || str.includes('Invalid Token')) {
                    INVALID_CREDS = true;
                    console.log(`xmrvsbeast credentials are invalid -> ${str}`);
                    return;
                }

                // Extract history data URL from response
                let matches = str.match(/src="\/p2pool\/history_logs\/[A-z0-9]{8}\.txt"/g);
                if (matches?.length) {
                    let match = matches[0]
                        .replace('src="', '')
                        .replace('.txt"', '.txt');

                    try {
                        let hist_data = (await axios.get(`https://xmrvsbeast.com${match}`,
                            {
                                headers: { 'User-Agent': `https://github.com/janderedev/p2pool-discord-webhook` }
                            })).data as string;

                        let lines = hist_data
                            .split('\n')
                            .map(line => line.replace(/\s+/g, ' '));

                            let file: DbFile;
                            try {
                                let fileBuf = await fs.promises.readFile(DBFILE_PATH);
                                file = JSON.parse(fileBuf.toString('utf-8'));
                            } catch(e) {
                                file = { blocksFound: 0 };
                                await fs.promises.writeFile(DBFILE_PATH, JSON.stringify(file, null, 4));
                            }

                            if (file.xmrvsbeastLastLine != lines[0]) {
                                console.log(lines[0]);

                                file.xmrvsbeastLastLine = lines[0];
                                let line = lines[0].split(' ');
                                let embed = new MessageEmbed()
                                    .setTitle('XvB Bonus Raffle');

                                if (lines[0].includes('ERROR:')) {
                                    // Format: yyyy-mm-dd hh:mm:ss ERROR: Error message
                                    let date  = line.shift();
                                    let time = line.shift();
                                    let errMsg = line.join(' ');

                                    embed
                                        .setDescription(errMsg)
                                        .addField('Date', date, true)
                                        .addField('Time', time, true)
                                        .setColor('#c54b4b');
                                } else {
                                    // Format: walletad...dress123 123.4kH/s yyyy-mm-dd ["Boost" if boost, empty otherwise]
                                    let [ addr, hashrate, date, boost ] = line;
                                    if (
                                        /[A-z0-9]{8}\.{3}[A-z0-9]{8}/.test(addr) &&
                                        /[0-9]+(\.[0-9]+)?kH\/s/.test(hashrate) &&
                                        /[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}/.test(date)
                                    ) {
                                        embed
                                            .setDescription(`You won the ${boost == 'Boost' ? '**boost**' : 'bonus'} raffle!`)
                                            .addField('Wallet address', addr, true)
                                            .addField('Bonus Hashrate', hashrate, true)
                                            .addField('Date', date, true)
                                            .setColor(boost == 'Boost' ? '#0c69ff' : '#50b343');
                                    } else {
                                        embed
                                            .setDescription(line.join(' '))
                                            .setColor('#c5973a');
                                    }
                                }

                                client.send(embed)
                                    .catch(console.error);

                                await fs.promises.writeFile(DBFILE_PATH, JSON.stringify(file, null, 4));
                            }
                    } catch(e) {
                        console.error(e);
                    }
                }
            });
        } catch(e) {
            console.error(e);
        }
    }

    run_xmrvsbeast();
    setInterval(run_xmrvsbeast, 60000);
} else console.log('$WALLET_ADDRESS or $XMRVSBEAST_TOKEN not set, not monitoring xmrvsbeast bonus raffle');

class DbFile {
    "blocksFound": number;
    "xmrvsbeastLastLine"?: string|null;
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
