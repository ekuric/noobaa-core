/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const { S3OPS } = require('../utils/s3ops');

class PooltFunctions {

    constructor(client, report, server_ip) {
        this._client = client;
        this._report = report;
        this._ip = server_ip;
        this._s3ops = new S3OPS({ ip: this._ip });
    }


    async report_success(params) {
        if (this._report) {
            await this._report.success(params);
        }
    }

    async report_fail(params) {
        if (this._report) {
            await this._report.fail(params);
        }
    }

    async getAllbucketsfiles(bucket) {
        const list_files = await this._s3ops.get_list_files(bucket);
        const keys = list_files.map(key => key.Key);
        return keys;
    }

    async checkFileInPool(file_name, pool, bucket) {
        let keep_run = true;
        let retry = 0;
        const MAX_RETRY = 15;
        let chunkAvailable;
        while (keep_run) {
            try {
                console.log(`Checking file ${file_name} is available and contains exactly in pool ${pool}`);
                const object_mappings = await this._client.object.read_object_mappings({
                    bucket,
                    key: file_name,
                    adminfo: true
                });
                chunkAvailable = object_mappings.parts.filter(chunk => chunk.chunk.adminfo.health === 'available');
                const chunkAvailablelength = chunkAvailable.length;
                const partsInPool = object_mappings.parts.filter(chunk =>
                    chunk.chunk.frags[0].blocks[0].adminfo.pool_name.includes(pool)).length;
                const chunkNum = object_mappings.parts.length;
                if (chunkAvailablelength === chunkNum) {
                    console.log(`Available chunks: ${chunkAvailablelength}/${chunkNum} for ${file_name}`);
                } else {
                    throw new Error(`Chanks for file ${file_name} should all be in ${
                    pool}, Expected ${chunkNum}, recived ${chunkAvailablelength}`);
                }
                if (partsInPool === chunkNum) {
                    console.log(`All The ${chunkNum} chanks are in ${pool}`);
                } else {
                    throw new Error(`Expected ${chunkNum} parts in ${pool} for file ${file_name}, recived ${partsInPool}`);
                }
                keep_run = false;
            } catch (e) {
                if (retry <= MAX_RETRY) {
                    retry += 1;
                    console.error(e);
                    console.log(`Sleeping for 20 sec and retrying`);
                    await P.delay(20 * 1000);
                } else {
                    console.error(chunkAvailable);
                    throw e;
                }
            }
        }
    }

    async createPoolWithAllTheOptimalHosts(suffix, pool_name) {
        let list = [];
        const list_hosts = await this._client.host.list_hosts({});
        try {
            for (const host of list_hosts.hosts) {
                if ((host.mode === 'OPTIMAL') && (host.name.includes(suffix))) {
                    list.push(host.name);
                }
            }
            console.log('Creating pool with online agents: ' + list);
            await this._client.pool.create_hosts_pool({
                name: pool_name,
                hosts: list
            });
            return pool_name;
        } catch (error) {
            throw new Error('Failed create healthy pool ' + pool_name + error);
        }
    }

    async assignNodesToPool(pool) {
        let listAgents = [];
        try {
            const list_hosts = await this._client.host.list_hosts({});
            for (const host of list_hosts.hosts) {
                if (host.mode === 'OPTIMAL') {
                    listAgents.push(host.name);
                }
            }
            console.log('Assigning online agents: ' + listAgents + ' to pool ' + pool);
            await this._client.pool.assign_hosts_to_pool({
                name: pool,
                hosts: listAgents
            });
        } catch (error) {
            throw new Error('Failed assigning nodes to pool ' + pool + error);
        }
    }
}

exports.PooltFunctions = PooltFunctions;
