/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const api = require('../../api');
const P = require('../../util/promise');
const { S3OPS } = require('../utils/s3ops');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);

const server_ops = require('../utils/server_functions');
const dbg = require('../../util/debug_module')(__filename);
const AzureFunctions = require('../../deploy/azureFunctions');
const agent_functions = require('../utils/agent_functions');
const { TierFunction } = require('../utils/tier_functions');
const { PoolFunctions } = require('../utils/pool_functions');
const { BucketFunctions } = require('../utils/bucket_functions');
dbg.set_process_name('tier_test');

//define colors
const NC = "\x1b[0m";
const YELLOW = "\x1b[33;1m";

const suffixName = 'tier';

const domain = process.env.DOMAIN;
const clientId = process.env.CLIENT_ID;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

//define defaults values
const DEFAULT_POOLS_NUMBER = 2;
const DEFAULT_NUMBER_OF_TIERS = 2;
const DEFAULT_AGENTS_NUMBER_PER_POOL = 3;
const DEFAULT_BUCKET_NAME = 'tier.bucket';
const DEFAULT_TIER_POLICY_NAME = 'first_policy';

const {
    resource,
    storage,
    vnet,
    agents_number = 6,
    failed_agents_number = 1,
    server_ip,
    id = 0,
    location = 'westus2',
    help = false,
} = argv;

const s3ops = new S3OPS({ ip: server_ip });

function usage() {
    console.log(`
    --location              -   azure location (default: ${location})
    --resource              -   azure resource group
    --storage               -   azure storage on the resource group
    --vnet                  -   azure vnet on the resource group
    --agents_number         -   number of agents to add (default: ${agents_number})
    --failed_agents_number  -   number of agents to fail (default: ${failed_agents_number})
    --server_ip             -   noobaa server ip.
    --id                    -   an id that is attached to the agents name
    --help                  -   show this help.
    `);
}

// const suffix = suffixName + '-' + id;
const suffix = '';

if (help) {
    usage();
    process.exit(1);
}

// we require this here so --help will not call datasets help.
const dataset = require('./dataset.js');

const dataset_params = {
    server_ip,
    bucket: DEFAULT_BUCKET_NAME,
    part_num_low: 2,
    part_num_high: 10,
    aging_timeout: 1,
    max_depth: 10,
    min_depth: 1,
    size_units: 'MB',
    // file_size_low: 50,
    // file_size_high: 200,
    file_size_low: 250, //TODO: remove
    file_size_high: 500, //TODO: remove
    no_exit_on_success: true,
    dataset_size: 1024 * 1,
};

const rpc = api.new_rpc('wss://' + server_ip + ':8443');
const client = rpc.new_client({});

const report = new Report();
const tier_functions = new TierFunction(client);
const bucket_functions = new BucketFunctions(client, report);
const pool_functions = new PoolFunctions(client, report, server_ip);

console.log(`${YELLOW}resource: ${resource}, storage: ${storage}, vnet: ${vnet}${NC}`);
const azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);

async function set_rpc_and_create_auth_token() {
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params);
}

async function getOptimalHosts(include_suffix) {
    let list = [];
    try {
        const list_hosts = await client.host.list_hosts({});
        for (const host of list_hosts.hosts) {
            if ((host.mode === 'OPTIMAL') && (host.name.includes(include_suffix))) {
                list.push(host.name);
            }
        }
        console.warn();
    } catch (e) {
        throw new Error(`Failed to getOptimalHosts` + e);
    }
    return list;
}

async function createPools(pools_number = DEFAULT_POOLS_NUMBER, agents_num_per_pool = DEFAULT_AGENTS_NUMBER_PER_POOL) {
    const pool_list = [];
    let list = await getOptimalHosts(suffix);
    let min_agents_num = pools_number * agents_num_per_pool;
    let retry = true;
    let retry_count = 1;
    const MAX_RETRIES = 5;
    while (retry) {
        if (min_agents_num > list.length) {
            if (retry_count <= MAX_RETRIES) {
                list = await getOptimalHosts(suffix);
                min_agents_num = pools_number * agents_num_per_pool;
            } else {
                console.warn(`Optimal host list is: ${list}`);
                throw new Error(`The number of agents are ${list.length}, expected at list ${min_agents_num}`);
            }
        } else {
            retry = false;
        }
    }
    try {
        let pool_number = 0;
        for (let i = 0; i < min_agents_num; i += agents_num_per_pool) {
            const pool_name = 'pool_tier' + pool_number;
            const agents_from_list = list.slice(i, i + agents_num_per_pool);
            console.log(`Creating ${pool_name} with online agents: ${agents_from_list}`);
            await client.pool.create_hosts_pool({
                name: pool_name,
                hosts: agents_from_list
            });
            pool_list.push(pool_name);
            pool_number += 1;
        }
        return pool_list;
    } catch (error) {
        throw new Error('Failed create all the pools ' + error);
    }
}

async function createTiers(pools, number_of_tiers = DEFAULT_NUMBER_OF_TIERS) {
    try {
        const tier_list = [];
        for (let i = 0; i < number_of_tiers; i += 1) {
            const tier_name = 'tier' + i;
            await tier_functions.createTier(tier_name, [pools[i]]);
            tier_list.push(tier_name);
        }
        console.log(`Created ${tier_list}`);
        return tier_list;
    } catch (e) {
        throw new Error(`failed to create a tier`);
    }
}

async function setTierPolicy(tiers, policy_name) {
    const orders = [];
    for (let i = 0; i < tiers.length; i += 1) {
        orders.push({ order: i, tier: tiers[i] });
    }
    try {
        await tier_functions.createTierPolicy(policy_name, orders);
        console.log(`Created ${policy_name}`);
    } catch (e) {
        throw new Error(`Failed to create Tier Policy` + e);
    }
}

async function checkAllFilesInTier(bucket, pool) {
    try {
        const file_list = await pool_functions.getAllBucketsFiles(bucket);
        for (const file_name of file_list) {
            console.log(`checking ${file_name}`);
            await pool_functions.checkFileInPool(file_name, pool, bucket);
        }
    } catch (e) {
        throw new Error(`not all files in ${pool}`);
    }
}

async function createAgents(number_of_agents = 6) {
    const osname = 'centos6';
    const agents = [];
    const created_agents = [];
    if (number_of_agents % 2 !== 0) {
        throw new Error(`createAgents:: we got number_of_agents = ${number_of_agents}, number_of_agents must be even`);
    }
    for (let i = 0; i < agents_number; ++i) {
        agents.push(suffixName + osname + id + i);
    }
    await P.map(agents, async agent => {
        const useDisk = (Number(agent.replace(suffixName + osname + id, '')) % 2 !== 0);
        let retry = true;
        let agent_ip;
        while (retry) {
            try {
                agent_ip = await azf.createAgent({
                    vmName: agent,
                    storage,
                    vnet,
                    os: osname,
                    agentConf: await agent_functions.getAgentConf(server_ip, useDisk ? ['/'] : ['']),
                    server_ip,
                    allocate_pip: true //LMLM: remove!
                });
                created_agents.push(agent);
                retry = false;
            } catch (e) {
                console.error(e);
            }
        }
        if (useDisk) {
            console.log(`adding data disk to vm ${agent} of size 16 GB`);
            try {
                await azf.addDataDiskToVM({
                    vm: agent,
                    size: 16,
                    storage,
                });
                await server_ops.map_new_disk_linux(agent_ip);
            } catch (e) {
                console.error(e);
                throw new Error(`failed to add disks`);
            }
        }
    });
    return created_agents;
}

async function get_pools_free_space(pool, unit, data_placement_number = 3) {
    const size = await pool_functions.getFreeSpaceFromPool(pool, unit);
    const size_after_data_placement = size / data_placement_number;
    return parseInt(size_after_data_placement, 10);
}

async function run_dataset(size) {
    //TODO: run the dataset in parallel.
    //TODO: divide the dataset into the concurrency
    dataset_params.dataset_size = 1024 * size;
    await dataset.init_parameters(dataset_params); //LMLM: Will need to change after marge with master
    await dataset.run_test();
}

async function main() {
    try {
        await azf.authenticate();
        await set_rpc_and_create_auth_token();
        //TODO: 1. have 6 agents 1st step get that from the outside. 2nd step create. (3 smaller and 3 larger capacity)
        await createAgents(agents_number);
        console.log(`${YELLOW}creating 2 pools and assign 3 agent for each${NC}`);
        //TODO: 2nd step do all the below with jest 1 pool
        const pools = await createPools();
        console.log(`${YELLOW}creating 2 tiers${NC}`);
        //TODO: in 2nd do more, that include more agents in step number one
        const tiers = await createTiers(pools);
        console.log(`${YELLOW}creating tier policy${NC}`);
        await setTierPolicy(tiers, DEFAULT_TIER_POLICY_NAME);
        await bucket_functions.createBucketWithPolicy(DEFAULT_BUCKET_NAME, DEFAULT_TIER_POLICY_NAME);
        console.log(`${YELLOW}writing some files to the pool (via the bucket)${NC}`);
        const size = await get_pools_free_space(pools[0], 'MB');
        await run_dataset(size / 3);
        console.log(`${YELLOW}checking that the files are in the first tier only${NC}`);
        await checkAllFilesInTier(DEFAULT_BUCKET_NAME, pools[0]);
        console.log(`${YELLOW}filling the first tier${NC}`);
        await run_dataset(size / 3 * 2);
        const files_per_tier = await tier_functions.mapAllFilesIntoTiers(DEFAULT_BUCKET_NAME);
        //TODO: 8. Check that the files passed as LRU (oldest atime first)
        //TODO: in 2nd step we need to test also the TTF
        console.log(JSON.stringify(files_per_tier));
        //TODO: 9. read the files
        //TODO: 10. check that the files passed from the second tier to the fist
        //TODO: 11. when the lower tiers are full see that we can still write (until the first is full...)
        //TODO: 12. try to read when all the agents in all the tiers are full
        //TODO: 13. delete some file from each tier
        //TODO: 14. update the tiers policy, and see that the files are rearranging.
        //TODO: 15. delete the policy, what should happens
        //TODO: 16. delete the tiers, what should happens
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();
