/* Copyright (C) 2016 NooBaa */
'use strict';

class TierFunction {

    constructor(client) {
        this._client = client;
    }

    async createTier(name, attached_pools) {
        try {
            const tier = await this._client.tier.create_tier({ name, attached_pools });
            return tier;
        } catch (err) {
            console.log('Create Tier ERR', err);
            throw err;
        }
    }

    async readTier(name) {
        try {
            const tier = await this._client.tier.read_tier({ name });
            return tier;
        } catch (err) {
            console.log('Read Tier ERR', err);
            throw err;
        }
    }

    async updateTierName(name, new_name) {
        try {
            const tier = await this._client.tier.update_tier({ name, new_name });
            return tier;
        } catch (err) {
            console.log('Update Tier ERR', err);
            throw err;
        }
    }

    async deleteTier(name) {
        try {
            const tier = await this._client.tier.delete_tier({ name });
            return tier;
        } catch (err) {
            console.log('Delete Tier ERR', err);
            throw err;
        }
    }

    async createTierPolicy(name, tiers) {
        try {
            const tier_policy = await this._client.tiering_policy.create_policy({
                name,
                tiers
            });
            return tier_policy;
        } catch (err) {
            console.log('Create Tier Policy  ERR', err);
            throw err;
        }
    }

    async updateTierPolicy(name, tiers) {
        try {
            const tier_policy = await this._client.tiering_policy.update_policy({
                name,
                tiers
            });
            return tier_policy;
        } catch (err) {
            console.log('Update Tier Policy  ERR', err);
            throw err;
        }
    }

    async readTierPolicy(name) {
        try {
            const tier_policy = await this._client.tiering_policy.read_policy({ name });
            return tier_policy;
        } catch (err) {
            console.log('Read Tier Policy  ERR', err);
            throw err;
        }
    }

    async deleteTierPolicy(name) {
        try {
            const tier_policy = await this._client.tiering_policy.delete_policy({ name });
            return tier_policy;
        } catch (err) {
            console.log('Delete Tier Policy  ERR', err);
            throw err;
        }
    }

    async mapAllFilesIntoTiers(bucket) {
        const list_files = await this._s3ops.get_list_files(bucket);
        const file_names = list_files.map(key => key.Key);
        const reply = {};
        for (const file_name of file_names) {
            reply[file_name] = [];
            const object_mappings = await this._client.object.read_object_mappings({
                bucket,
                key: file_name,
                adminfo: true
            });
            object_mappings.parts.forEach(part => {
                if (!reply[file_name].includes(part.chunk.tier)) {
                    reply[file_name].push(part.chunk.tier);
                }
            });
        }
        return reply;
    }
}

exports.TierFunction = TierFunction;
