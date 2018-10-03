/* Copyright (C) 2016 NooBaa */
'use strict';

const api = require('../../api');
const { S3OPS } = require('../utils/s3ops');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);

const dbg = require('../../util/debug_module')(__filename);
const AzureFunctions = require('../../deploy/azureFunctions');
const { TierFunction } = require('../utils/tier_functions');
const { BucketFunctions } = require('../utils/bucket_functions');
dbg.set_process_name('tier');

//define colors
const NC = "\x1b[0m";
const YELLOW = "\x1b[33;1m";

const suffixName = 'tier';

const domain = process.env.DOMAIN;
const clientId = process.env.CLIENT_ID;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

const {
    location = 'westus2',
        resource,
        storage,
        vnet,
        agents_number = 6,
        failed_agents_number = 1,
        server_ip,
        id = 0,
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

const suffix = suffixName + '-' + id;

if (help) {
    usage();
    process.exit(1);
}

const rpc = api.new_rpc('wss://' + server_ip + ':8443');
const client = rpc.new_client({});

const report = new Report();
const bf = new BucketFunctions(client, report);
const tf = new TierFunction(client, report);

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

async function main() {
    await set_rpc_and_create_auth_token();
    //TODO: 1. have 6 agents 1st step get that from the outside. 2nd step create. (3 smaller and 3 larger capacity)
    //TODO: 2. create 3 pools and assign 3 agent for each
    //TODO: 3. create 2 tiers [0, 1] (1st step, in 2nd do more, that include more agents)
    //TODO: 4. create tier policy
    //TODO: 5. write some files to the pool (via the bucket)
    //TODO: 6. check that the files are in the first tier
    //TODO: 7. fill the first tier and check that the files passed to the second tier
    //         in 1st step, in 2nd step we need to test also the TTF
    //TODO: 8. Check that the files passed as LRU (oldest atime first)
    //TODO: 9. read the files
    //TODO: 10. check that the files passed from the second tier to the fist
    //TODO: 11. when the lower tiers are full see that we can still write (until the first is full...)
    //TODO: 12. try to read when all the agents in all the tiers are full
    //TODO: 13. delete some file from each tier
    //TODO: 14. update the tiers policy, and see that the files are rearranging.
    //TODO: 15. delete the policy, what should happens
    //TODO: 16. delete the tiers, what should happens
}

main();
