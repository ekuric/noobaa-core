/* Copyright (C) 2016 NooBaa */
'use strict';

class TierFunction {

    constructor(client, report) {
        this._client = client;
        this._report = report;
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

    async createTier(name) {
        try {
            const tier = await this._client.tier.create_tier({ name });
            await this.report_success(`Create_Tier`);
            return tier;
        } catch (err) {
            await this.report_fail(`Create_Tier`);
            console.log('Create Tier ERR', err);
            throw err;
        }
    }

    async readTier(name) {
        try {
            const tier = await this._client.tier.read_tier({ name });
            await this.report_success(`Read_Tier`);
            return tier;
        } catch (err) {
            await this.report_fail(`Read_Tier`);
            console.log('Read Tier ERR', err);
            throw err;
        }
    }

    async updateTier(name, new_name) {
        try {
            const tier = await this._client.tier.update_tier({ name, new_name });
            await this.report_success(`Update_Tier`);
            return tier;
        } catch (err) {
            await this.report_fail(`Update_Tier`);
            console.log('Update Tier ERR', err);
            throw err;
        }
    }

    async deleteTier(name) {
        try {
            const tier = await this._client.tier.delete_tier({ name });
            await this.report_success(`Delete_Tier`);
            return tier;
        } catch (err) {
            await this.report_fail(`Delete_Tier`);
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
            await this.report_success(`Create_Tier_Policy`);
            return tier_policy;
        } catch (err) {
            await this.report_fail(`Create_Tier_Policy`);
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
            await this.report_success(`Update_Tier_Policy`);
            return tier_policy;
        } catch (err) {
            await this.report_fail(`Update_Tier_Policy`);
            console.log('Update Tier Policy  ERR', err);
            throw err;
        }
    }

    async readTierPolicy(name) {
        try {
            const tier_policy = await this._client.tiering_policy.read_policy({ name });
            await this.report_success(`Read_Tier_Policy`);
            return tier_policy;
        } catch (err) {
            await this.report_fail(`Read_Tier_Policy`);
            console.log('Read Tier Policy  ERR', err);
            throw err;
        }
    }

    async deleteTierPolicy(name) {
        try {
            const tier_policy = await this._client.tiering_policy.delete_policy({ name });
            await this.report_success(`Delete_Tier_Policy`);
            return tier_policy;
        } catch (err) {
            await this.report_fail(`Delete_Tier_Policy`);
            console.log('Delete Tier Policy  ERR', err);
            throw err;
        }
    }
}

exports.TierFunction = TierFunction;
