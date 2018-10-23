/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const { S3OPS } = require('../utils/s3ops');

class PoolFunctions {

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

    async getAllBucketsFiles(bucket) {
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
                chunkAvailable = object_mappings.parts.filter(part => part.chunk.adminfo.health === 'available');
                const chunkAvailableLength = chunkAvailable.length;
                const partsInPool = object_mappings.parts.filter(part =>
                    part.chunk.frags[0].blocks[0].adminfo.pool_name.includes(pool)).length;
                const chunkNum = object_mappings.parts.length;
                if (chunkAvailableLength === chunkNum) {
                    console.log(`Available chunks: ${chunkAvailableLength}/${chunkNum} for ${file_name}`);
                } else {
                    throw new Error(`Chunks for file ${file_name} should all be in ${
                    pool}, Expected ${chunkNum}, received ${chunkAvailableLength}`);
                }
                if (partsInPool === chunkNum) {
                    console.log(`All The ${chunkNum} chunks are in ${pool}`);
                } else {
                    throw new Error(`Expected ${chunkNum} parts in ${pool} for file ${file_name}, received ${partsInPool}`);
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
            await this.report_success(`create_host_pool`);
            return pool_name;
        } catch (error) {
            await this.report_fail(`create_host_pool`);
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
            await this.report_success(`assign_hosts_to_pool`);
        } catch (error) {
            await this.report_success(`assign_hosts_to_pool`);
            throw new Error('Failed assigning nodes to pool ' + pool + error);
        }
    }

    async getFreeSpaceFromPool(pool, unit) {
        try {
            const BASE_UNIT = 1024;
            const UNIT_MAPPING = {
                KB: Math.pow(BASE_UNIT, 1),
                MB: Math.pow(BASE_UNIT, 2),
                GB: Math.pow(BASE_UNIT, 3),
            };
            if (!Object.keys(UNIT_MAPPING).includes(unit)) {
                throw new Error('unit must be ' + Object.keys(UNIT_MAPPING));
            }
            const size_in_bytes = await this._client.pool.read_pool({ name: pool });
            return size_in_bytes.storage.free / UNIT_MAPPING[unit];
        } catch (error) {
            throw new Error(error);
        }
    }
}

exports.PoolFunctions = PoolFunctions;
