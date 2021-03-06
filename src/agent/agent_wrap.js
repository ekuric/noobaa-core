/* Copyright (C) 2016 NooBaa */
"use strict";

/*
 * This script wraps agent_cli
 * it keeps it alive and should also handle ugprades, repairs etc.
 */
const os = require('os');
const fs = require('fs');
const url = require('url');
const request = require('request');
const path = require('path');

const WIN_AGENT = os.type() === 'Windows_NT';

const P = require('../util/promise');
const fs_utils = require('../util/fs_utils');
const os_utils = require('../util/os_utils');
const buffer_utils = require('../util/buffer_utils');
const promise_utils = require('../util/promise_utils');
const child_process = require('child_process');
const dbg = require('../util/debug_module')(__filename);
dbg.set_process_name('agent_wrapper');



const AGENT_MSG_CODES = Object.freeze([
    'UPGRADE',
    'DUPLICATE',
    'UNINSTALL',
    'NOTFOUND'
]);

const EXECUTABLE_MOD_VAL = 511;

const CONFIGURATION = {
    SETUP_FILENAME: WIN_AGENT ? 'noobaa-setup.exe' : 'noobaa-setup',
    MD5_FILENAME: WIN_AGENT ? 'noobaa-setup.exe.md5' : 'noobaa-setup.md5',
    UNINSTALL_FILENAME: WIN_AGENT ? 'uninstall-noobaa.exe' : 'uninstall_noobaa_agent.sh',
    PROCESS_DIR: path.join(__dirname, '..', '..'),
    AGENT_CLI: './src/agent/agent_cli',
    NUM_UPGRADE_WARNINGS: WIN_AGENT ? 3 : 18, // for windows it seems unnecessary to wait. reducing for now
    TIME_BETWEEN_WARNINGS: 10000,
    PATHS_TO_BACKUP: ['src', 'node_modules', 'build'],
};

CONFIGURATION.SETUP_FILE = path.join(CONFIGURATION.PROCESS_DIR, CONFIGURATION.SETUP_FILENAME);
CONFIGURATION.MD5_FILE = path.join(CONFIGURATION.PROCESS_DIR, CONFIGURATION.MD5_FILENAME);
CONFIGURATION.UNINSTALL_FILE = CONFIGURATION.PROCESS_DIR + (WIN_AGENT ? '\\' : '/') + CONFIGURATION.UNINSTALL_FILENAME;
CONFIGURATION.INSTALLATION_COMMAND = WIN_AGENT ? `"${CONFIGURATION.SETUP_FILE}" /S` :
    `setsid ${CONFIGURATION.SETUP_FILE} >> /dev/null`;
CONFIGURATION.UNINSTALL_COMMAND = WIN_AGENT ? `"${CONFIGURATION.UNINSTALL_FILE}" /S` :
    `setsid ${CONFIGURATION.UNINSTALL_FILE} >> /dev/null`;
CONFIGURATION.WIN_OLD_NODE_FILE = path.join(CONFIGURATION.PROCESS_DIR, 'node_old.exe');

process.chdir(path.join(__dirname, '..', '..'));
CONFIGURATION.BACKUP_DIR = path.join(process.cwd(), `backup`);

let address = "";
let new_backup_dir = CONFIGURATION.BACKUP_DIR;

function _download_file(request_url, output) {
    return new P((resolve, reject) => {
        request.get({
                url: request_url,
                strictSSL: false,
                timeout: 20000
            })
            .on('error', err => {
                dbg.warn('Error downloading NooBaa agent upgrade from', address);
                return reject(err);
            })
            .pipe(output)
            .on('error', err => reject(err))
            .on('finish', resolve);
    });
}

async function run_agent_cli(agent_args = []) {
    return new P((resolve, reject) => {
        const args = [CONFIGURATION.AGENT_CLI, ...agent_args];
        const agent_cli_proc = child_process.spawn('./node', args, {
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            detached: false
        });
        let promise_handled = false;

        // on agent message kill agent_cli and return the message code
        agent_cli_proc.on('message', msg => {
            promise_handled = true;
            agent_cli_proc.kill('SIGKILL');
            if (!AGENT_MSG_CODES.includes(msg.code)) reject(new Error('agent_cli sent unknown message'));
            resolve(msg.code);
        });

        // agent_cli should not exit on normal flow. throw error on exit\error
        agent_cli_proc.on('exit', (code, signal) => {
            if (!promise_handled) {
                dbg.error(`agent_cli exited for unknown reason. code=${code}, signal=${signal}`);
                promise_handled = true;
                let e = new Error(`agent_cli exited for unknown reason. code=${code}, signal=${signal}`);
                e.code = code;
                reject(e);
            }
        });

        agent_cli_proc.on('error', err => {
            dbg.error(`agent_cli exited with error`, err);
            if (!promise_handled) {
                promise_handled = true;
                reject(err);
            }
        });
    });
}



dbg.log0('deleting file', CONFIGURATION.SETUP_FILE);


async function clean_old_files() {
    try {
        // clean previous setup file (why?)
        await fs_utils.file_delete(CONFIGURATION.SETUP_FILE);
        if (WIN_AGENT) {
            // if running on windows - clean node_old.exe
            await fs_utils.file_delete(CONFIGURATION.WIN_OLD_NODE_FILE);
        }

        // clean previous backup dir
        const files = await fs.readdirAsync(process.cwd());
        const backup_dir = files.find(file => file.startsWith('backup_'));
        if (backup_dir) {
            dbg.log0(`found backup dir ${backup_dir}, deleting old backup dir, and renaming ${backup_dir} to backup`);
            await fs_utils.folder_delete(CONFIGURATION.BACKUP_DIR);
            await fs.renameAsync(backup_dir, CONFIGURATION.BACKUP_DIR);
        }
    } catch (err) {
        dbg.error('failed on clean_old_files. continue as usual', err);
    }
}

async function upgrade_agent() {
    dbg.log0('starting agent upgrade. downloading upgrade file..');
    await _download_file(`https://${address}/public/${CONFIGURATION.SETUP_FILENAME}`, fs.createWriteStream(CONFIGURATION.SETUP_FILE));

    const md5_out = buffer_utils.write_stream();
    // verify setup file md5:
    const [, agent_md5] = await P.all([
        _download_file(`https://${address}/public/${CONFIGURATION.MD5_FILENAME}`, md5_out),
        fs_utils.get_md5_of_file(CONFIGURATION.SETUP_FILE)
    ]);
    const server_md5 = buffer_utils.join(md5_out.buffers).toString();
    if (agent_md5.trim() !== server_md5.trim()) {
        throw new Error(`MD5 is incompatible between server (MD5:${server_md5}) and agent(MD5:${agent_md5})`);
    }
    dbg.log0('Checking md5 of downloaded version passed:', agent_md5);

    // make setup file executable
    await fs.chmodAsync(CONFIGURATION.SETUP_FILE, EXECUTABLE_MOD_VAL);

    // backup agent dir before upgrade:
    new_backup_dir += '_' + String(Date.now());
    dbg.log0('backup old code to backup dir', new_backup_dir);
    await fs_utils.create_path(new_backup_dir);
    for (const file of CONFIGURATION.PATHS_TO_BACKUP) {
        const old_path = path.join(process.cwd(), file);
        const new_path = path.join(new_backup_dir, file);
        dbg.log0(`moving ${old_path} to ${new_path}`);
        try {
            await fs.renameAsync(old_path, new_path);
        } catch (err) {
            dbg.error(`failed moving ${old_path} to ${new_path}`);
        }
    }
    await P.delay(2000); // Not sure why this is necessary, but it is.

    dbg.log0('running agent installation command: ', CONFIGURATION.INSTALLATION_COMMAND);
    await promise_utils.exec(CONFIGURATION.INSTALLATION_COMMAND);

    // installation of new version should eventually stop this agent_wrapper instance and restart in the new version
    // wait for agent_wrapper to get killed
    await promise_utils.retry(CONFIGURATION.NUM_UPGRADE_WARNINGS,
        CONFIGURATION.TIME_BETWEEN_WARNINGS, attempts => {
            let msg = `Still upgrading. ${(CONFIGURATION.NUM_UPGRADE_WARNINGS - attempts) * (CONFIGURATION.TIME_BETWEEN_WARNINGS / 1000)} seconds have passed.`;
            if (attempts !== CONFIGURATION.NUM_UPGRADE_WARNINGS) dbg.warn(msg);
            throw new Error(msg);
        });
}

async function main() {

    dbg.log0('starting agent_wrapper. OS info:', await os_utils.get_distro());

    await clean_old_files();

    // get server address from agent_conf
    address = url.parse(JSON.parse(await fs.readFileAsync(os_utils.get_agent_platform_path().concat('agent_conf.json'))).address).host;

    try {
        dbg.log0('Starting agent_cli');
        const agent_res = await run_agent_cli();
        dbg.log0(`agent_cli returned result: ${agent_res}`);

        switch (agent_res) {
            case 'UPGRADE':
                await upgrade_agent();
                break;
            case 'DUPLICATE':
                dbg.log0('Duplicate token. calling agent_cli with --duplicate flag');
                await promise_utils.fork(CONFIGURATION.AGENT_CLI, ['--duplicate'], { stdio: 'ignore' });
                break;
            case 'UNINSTALL':
                //TODO: maybe move handling of duplicate\notfound to agent_wrapper instead of calling agent_cli with a flag
                dbg.log0('Agent to be uninstalled');
                await promise_utils.exec(CONFIGURATION.UNINSTALL_COMMAND);
                break;
            case 'NOTFOUND':
                dbg.log0('Agent not found. calling agent_cli with --notfound flag');
                await promise_utils.fork(CONFIGURATION.AGENT_CLI, ['--notfound'], { stdio: 'ignore' });
                break;
            default:
                break;
        }
    } catch (err) {
        dbg.error('agent_wrapper failed with error. should exit and restart now', err);
    }
}

if (require.main === module) {
    main();
}
