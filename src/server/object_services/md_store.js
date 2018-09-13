/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const assert = require('assert');
const moment = require('moment');
const mongodb = require('mongodb');
const mime = require('mime');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const mongo_utils = require('../../util/mongo_utils');
const mongo_client = require('../../util/mongo_client');
const nodes_client = require('../node_services/nodes_client');
const mongo_functions = require('../../util/mongo_functions');
const object_md_schema = require('./schemas/object_md_schema');
const object_md_indexes = require('./schemas/object_md_indexes');
const object_part_schema = require('./schemas/object_part_schema');
const object_part_indexes = require('./schemas/object_part_indexes');
const object_multipart_schema = require('./schemas/object_multipart_schema');
const object_multipart_indexes = require('./schemas/object_multipart_indexes');
const data_chunk_schema = require('./schemas/data_chunk_schema');
const data_chunk_indexes = require('./schemas/data_chunk_indexes');
const data_block_schema = require('./schemas/data_block_schema');
const data_block_indexes = require('./schemas/data_block_indexes');


class MDStore {

    constructor(test_suffix = '') {
        this._objects = mongo_client.instance().define_collection({
            name: 'objectmds' + test_suffix,
            schema: object_md_schema,
            db_indexes: object_md_indexes,
        });
        this._multiparts = mongo_client.instance().define_collection({
            name: 'objectmultiparts' + test_suffix,
            schema: object_multipart_schema,
            db_indexes: object_multipart_indexes,
        });
        this._parts = mongo_client.instance().define_collection({
            name: 'objectparts' + test_suffix,
            schema: object_part_schema,
            db_indexes: object_part_indexes,
        });
        this._chunks = mongo_client.instance().define_collection({
            name: 'datachunks' + test_suffix,
            schema: data_chunk_schema,
            db_indexes: data_chunk_indexes,
        });
        this._blocks = mongo_client.instance().define_collection({
            name: 'datablocks' + test_suffix,
            schema: data_block_schema,
            db_indexes: data_block_indexes,
        });
        this._sequences = mongo_client.instance().define_collection({
            name: 'mdsequences' + test_suffix,
        });
    }

    static instance() {
        if (!MDStore._instance) MDStore._instance = new MDStore();
        return MDStore._instance;
    }

    async is_objectmds_indexes_ready() {

        // This checks if the needed indexes exist on the collection
        // Note: we only check for the existence of named indexes
        const existing_indexes = _.keyBy(await this._objects.col().indexes(), 'name');
        for (const index of object_md_indexes) {
            if (index.name && !existing_indexes[index.name]) return false;
        }

        // Checks if there is a current background operation that creates indexes on objectmds
        const current_op = await mongo_client.instance().db.admin().command({ currentOp: 1 });
        for (const op of current_op.inprog) {
            if (op.command &&
                op.command.createIndexes === 'objectmds' &&
                op.command.indexes.length) {
                return false;
            }
        }
        return true;
    }

    make_md_id(id_str) {
        return new mongodb.ObjectId(id_str);
    }

    make_md_id_from_time(time, zero_suffix) {
        const hex_time = Math.floor(time / 1000).toString(16);
        assert(hex_time.length <= 8);
        const padded_hex_time = '0'.repeat(8 - hex_time.length) + hex_time;
        var suffix;
        if (zero_suffix) {
            suffix = '0'.repeat(16);
        } else {
            suffix = String(new mongodb.ObjectId()).slice(8, 24);
        }
        const hex_id = padded_hex_time + suffix;
        assert(padded_hex_time.length === 8);
        assert(suffix.length === 16);
        assert(hex_id.length === 24);
        assert(parseInt(padded_hex_time, 16) === Math.floor(time / 1000));
        return new mongodb.ObjectId(hex_id);
    }

    is_valid_md_id(id_str) {
        return mongodb.ObjectId.isValid(id_str);
    }

    /////////////
    // OBJECTS //
    /////////////


    async insert_object(info) {
        this._objects.validate(info);
        return this._objects.col().insertOne(info);
    }

    async update_object_by_id(obj_id, set_updates, unset_updates, inc_updates) {
        console.log('update_object_by_id:', obj_id, compact_updates(set_updates, unset_updates, inc_updates));
        const res = await this._objects.col().updateOne({ _id: obj_id },
            compact_updates(set_updates, unset_updates, inc_updates)
        );
        mongo_utils.check_update_one(res, 'object');
    }

    find_object_by_id(obj_id) {
        return this._objects.col().findOne({ _id: obj_id });
    }

    populate_objects(docs, doc_path, fields) {
        return mongo_utils.populate(docs, doc_path, this._objects.col(), fields);
    }

    async find_object_latest(bucket_id, key) {
        return this._objects.col().findOne({
            // index fields:
            bucket: bucket_id,
            key,
            version_past: null,
            // partialFilterExpression:
            deleted: null,
            upload_started: null,
        }, {
            hint: 'latest_version_index',
            sort: { bucket: 1, key: 1, version_past: 1 },
        });
    }

    async find_object_null_version(bucket_id, key) {
        return this._objects.col().findOne({
            // index fields:
            bucket: bucket_id,
            key,
            version_enabled: null,
            // partialFilterExpression:
            deleted: null,
            upload_started: null,
        }, {
            hint: 'null_version_index',
            sort: { bucket: 1, key: 1, version_enabled: 1 },
        });
    }

    async find_object_by_version(bucket_id, key, version_seq) {
        return this._objects.col().findOne({
            // index fields:
            bucket: bucket_id,
            key,
            version_seq,
            // partialFilterExpression:
            deleted: null,
            upload_started: null,
        }, {
            hint: 'version_seq_index',
            sort: { bucket: 1, key: 1, version_seq: -1 },
        });
    }

    async find_object_prev_version(bucket_id, key) {
        return this._objects.col().findOne({
            // index fields:
            bucket: bucket_id,
            key: key,
            // partialFilterExpression:
            deleted: null,
            upload_started: null,
            // scan:
            // `version_past: null` is limited to 1 because latest_version_index is unique,
            // so worst case we scan 2 docs before we find one with `version_past: true`
            version_past: true,
        }, {
            hint: 'version_seq_index',
            sort: { bucket: 1, key: 1, version_seq: -1 },
        });
    }

    // 2, 3
    async remove_object_and_unset_latest(obj) {
        const res = await this._objects.col().updateOne({
            _id: obj._id,
            deleted: null
        }, {
            $set: {
                deleted: new Date(),
                version_past: true,
            },
        });
        mongo_utils.check_update_one(res, 'object');
    }

    // 2, 3, 4
    async remove_object_move_latest(old_latest_obj, new_latest_obj) {
        const bulk = this._objects.col().initializeOrderedBulkOp();
        bulk.find({ _id: old_latest_obj._id, deleted: null })
            .updateOne({ $set: { deleted: new Date(), version_past: true } });
        bulk.find({ _id: new_latest_obj._id, deleted: null })
            .updateOne({ $unset: { version_past: true } });
        const res = await bulk.execute();
        if (!res.ok || res.nMatched !== 2 || res.nModified !== 2) {
            dbg.error('remove_object_move_latest: partial bulk update',
                _.clone(res), old_latest_obj, new_latest_obj);
            throw new Error('remove_object_move_latest: partial bulk update');
        }
    }

    async _delete_marker_from_obj(obj, version_enabled) {
        const version_seq = await this.alloc_object_version_seq();
        const delete_marker = {
            _id: MDStore.instance().make_md_id(),
            system: obj.system,
            bucket: obj.bucket,
            key: obj.key,
            content_type: obj.content_type || mime.getType(obj.key) || 'application/octet-stream',
            delete_marker: true,
            create_time: new Date(),
            version_seq,
        };
        if (version_enabled) delete_marker.version_enabled = true;
        return delete_marker;
    }

    async insert_object_delete_marker(obj) {
        const delete_marker = await this._delete_marker_from_obj(obj, obj.version_enabled);
        await MDStore.instance().insert_object(delete_marker);
        return delete_marker;
    }

    async insert_object_delete_marker_move_latest(obj, version_enabled) {
        const delete_marker = await this._delete_marker_from_obj(obj, version_enabled);
        const bulk = this._objects.col().initializeOrderedBulkOp();
        bulk.find({ _id: obj._id, deleted: null })
            .updateOne({ $set: { version_past: true } });
        bulk.insert(delete_marker);
        const res = await bulk.execute();
        if (!res.ok || res.nMatched !== 1 || res.nModified !== 1 || res.nInserted !== 1) {
            dbg.error('insert_object_delete_marker_move_latest: partial bulk update',
                _.clone(res), obj, delete_marker);
            throw new Error('insert_object_delete_marker_move_latest: partial bulk update');
        }
        return delete_marker;
    }

    async complete_object_upload_latest_mark_remove_current({
        unmark_obj,
        put_obj,
        set_updates,
        unset_updates,
    }) {
        const bulk = this._objects.col().initializeOrderedBulkOp();
        bulk.find({ _id: unmark_obj._id, deleted: null })
            .updateOne({ $set: { version_past: true } });
        bulk.find({ _id: put_obj._id, deleted: null })
            .updateOne({ $set: set_updates, $unset: unset_updates });
        const res = await bulk.execute();
        if (!res.ok || res.nMatched !== 2 || res.nModified !== 2) {
            dbg.error('complete_object_upload_latest_mark_remove_current: partial bulk update',
                _.clone(res), unmark_obj, put_obj, set_updates, unset_updates);
            throw new Error('complete_object_upload_latest_mark_remove_current: partial bulk update');
        }
    }

    async complete_object_upload_latest_mark_remove_current_and_delete({
        delete_obj,
        unmark_obj,
        put_obj,
        set_updates,
        unset_updates,
    }) {
        const bulk = this._objects.col().initializeOrderedBulkOp();
        if (delete_obj) {
            bulk.find({ _id: delete_obj._id, deleted: null })
                .updateOne({ $set: { deleted: new Date() } });
            bulk.find({ _id: unmark_obj._id, deleted: null })
                .updateOne({ $set: { version_past: true } });
        } else {
            bulk.find({ _id: unmark_obj._id, deleted: null })
                .updateOne({ $set: { deleted: new Date(), version_past: true } });
        }

        bulk.find({ _id: put_obj._id, deleted: null })
            .updateOne({ $set: set_updates, $unset: unset_updates });
        const res = await bulk.execute();
        const number_of_queries = delete_obj ? 3 : 2;
        if (!res.ok || res.nMatched !== number_of_queries || res.nModified !== number_of_queries) {
            dbg.error('complete_object_upload_latest_mark_remove_current_and_delete: partial bulk update',
                _.clone(res), unmark_obj, put_obj, set_updates, unset_updates);
            throw new Error('complete_object_upload_latest_mark_remove_current_and_delete: partial bulk update');
        }
    }

    // This is for the 2, 3 and 3` for latest removal (3 objects)
    async insert_object_delete_marker_move_latest_with_delete(obj, latest_obj) {
        const delete_marker = await this._delete_marker_from_obj(obj, obj.version_enabled);
        const bulk = this._objects.col().initializeOrderedBulkOp();
        let num_updates = 0;
        if (latest_obj) {
            bulk.find({ _id: latest_obj._id, deleted: null })
                .updateOne({ $set: { version_past: true } });
            bulk.find({ _id: obj._id, deleted: null })
                .updateOne({ $set: { deleted: new Date() } });
            num_updates = 2;
        } else {
            bulk.find({ _id: obj._id, deleted: null })
                .updateOne({ $set: { deleted: new Date(), version_past: true } });
            num_updates = 1;
        }
        bulk.insert(delete_marker);
        const res = await bulk.execute();
        if (!res.ok || res.nMatched !== num_updates || res.nModified !== num_updates || res.nInserted !== 1) {
            dbg.error('insert_object_delete_marker_move_latest_with_delete: partial bulk update',
                _.clone(res), latest_obj, obj, delete_marker);
            throw new Error('insert_object_delete_marker_move_latest_with_delete: partial bulk update');
        }
        return delete_marker;
    }

    async alloc_object_version_seq() {
        // empty query, we maintain a single doc in this collection
        const query = {};
        const update = { $inc: { object_version_seq: 1 } };
        const options = { upsert: true };
        // if the first update returns null it means we just inserted the doc for the first time
        // so we just call again in order to increase the sequence and get the first seq.
        let res = await this._sequences.col().findOneAndUpdate(query, update, options);
        if (res && res.value && res.value.object_version_seq) return res.value.object_version_seq;
        res = await this._sequences.col().findOneAndUpdate(query, update, options);
        return res.value.object_version_seq;
    }

    // TODO define indexes used by find_objects()
    async find_objects({
        bucket_id,
        key,
        upload_mode,
        latest_versions,
        filter_delete_markers,
        max_create_time,
        skip,
        limit,
        sort,
        order,
        pagination,
    }) {
        let version_past;
        if (latest_versions === true) version_past = null;
        else if (latest_versions === false) version_past = true;
        let delete_marker;
        if (filter_delete_markers === true) delete_marker = null;
        else if (filter_delete_markers === false) delete_marker = true;
        const query = compact({
            bucket: bucket_id,
            key: key,
            deleted: null,
            // allow filtering of uploading/non-uploading objects
            create_time: max_create_time ? {
                $lt: new Date(moment.unix(max_create_time).toISOString())
            } : undefined,
            upload_started: typeof upload_mode === 'boolean' ? {
                $exists: upload_mode
            } : undefined,
            version_past,
            delete_marker
        });

        const completed_query = _.omit(query, 'upload_started');
        completed_query.upload_started = { $exists: false };
        const uploading_query = _.omit(query, 'upload_started');
        uploading_query.upload_started = { $exists: true };

        dbg.log0('find_objects:', query);

        const [objects, non_paginated, completed, uploading] = await P.join(

            this._objects.col().find(query, {
                limit: Math.min(limit, 1000),
                skip: skip,
                sort: sort ? {
                    [sort]: (order === -1 ? -1 : 1)
                } : undefined
            }).toArray(),

            pagination ? this._objects.col().count(query) : undefined,

            // completed uploads count
            this._objects.col().count(completed_query),

            // uploading count
            this._objects.col().count(uploading_query)
        );

        return {
            objects,
            counters: {
                non_paginated,
                by_mode: {
                    completed,
                    uploading
                }
            }
        };
    }

    async list_objects({
        bucket_id,
        delimiter,
        prefix,
        key_marker,
        limit
    }) {
        const hint = 'latest_version_index';
        const sort = { bucket: 1, key: 1, version_past: 1 };

        const { key_query } = this._build_list_key_query_from_markers(prefix, delimiter, key_marker);

        const query = compact({
            // index fields:
            bucket: bucket_id,
            key: key_query,
            version_past: null,
            // partialFilterExpression:
            deleted: null,
            upload_started: null,
            // scan (max 1):
            delete_marker: null
        });

        if (delimiter) {
            const mr_results = await this._objects.col().mapReduce(
                mongo_functions.map_common_prefixes,
                mongo_functions.reduce_common_prefixes, {
                    query,
                    limit,
                    sort,
                    hint, // hint is not supported in mapReduce, so assume sort will enforce the correct index
                    scope: { prefix, delimiter },
                    out: { inline: 1 }
                }
            );
            const results = normalize_list_mr_results(mr_results, prefix);
            results.sort(sort_list_objects_with_delimiter);
            return results;
        } else {
            const results = await this._objects.col().find(query, {
                limit,
                sort,
                hint,
            }).toArray();
            return results;
        }
    }

    async list_object_versions({
        bucket_id,
        delimiter,
        prefix,
        key_marker,
        limit,
        version_seq_marker,
    }) {
        const hint = 'version_seq_index';
        const sort = { bucket: 1, key: 1, version_seq: -1 };

        const { key_query, or_query } = this._build_list_key_query_from_markers(
            prefix, delimiter, key_marker, /*upload_started_marker*/ undefined, version_seq_marker
        );

        const query = compact({
            // index fields:
            bucket: bucket_id,
            key: key_query,
            $or: or_query,
            // partialFilterExpression:
            deleted: null,
            upload_started: null,
        });

        if (delimiter) {
            const mr_results = await this._objects.col().mapReduce(
                mongo_functions.map_common_prefixes,
                mongo_functions.reduce_common_prefixes, {
                    query,
                    limit,
                    sort,
                    hint, // hint is not supported in mapReduce, so assume sort will enforce the correct index
                    scope: { prefix, delimiter },
                    out: { inline: 1 }
                }
            );
            const results = normalize_list_mr_results(mr_results, prefix);
            results.sort(sort_list_versions_with_delimiter);
            return results;
        } else {
            const results = await this._objects.col().find(query, {
                limit,
                sort,
                hint,
            }).toArray();
            return results;
        }
    }

    async list_uploads({
        bucket_id,
        delimiter,
        prefix,
        key_marker,
        limit,
        upload_started_marker,
    }) {
        const hint = 'upload_index';
        const sort = { bucket: 1, key: 1, upload_started: 1 };

        const { key_query, or_query } = this._build_list_key_query_from_markers(
            prefix, delimiter, key_marker, upload_started_marker, /*version_seq_marker*/ undefined
        );

        const query = compact({
            // index fields:
            bucket: bucket_id,
            key: key_query,
            $or: or_query,
            // partialFilterExpression:
            deleted: null,
            // Note: $exists is less optimized than comparing to null
            upload_started: { $exists: true }
        });

        if (delimiter) {
            const mr_results = await this._objects.col().mapReduce(
                mongo_functions.map_common_prefixes,
                mongo_functions.reduce_common_prefixes, {
                    query,
                    limit,
                    sort,
                    hint, // hint is not supported in mapReduce, so assume sort will enforce the correct index
                    scope: { prefix, delimiter },
                    out: { inline: 1 }
                }
            );
            const results = normalize_list_mr_results(mr_results, prefix);
            results.sort(sort_list_uploads_with_delimiter);
            return results;
        } else {
            const results = await this._objects.col().find(query, {
                limit,
                sort,
                hint,
            }).toArray();
            return results;
        }
    }

    _build_list_key_query_from_prefix(prefix) {
        // filter keys starting with prefix
        return prefix ? { key_query: new RegExp('^' + _.escapeRegExp(prefix)) } : {};
    }

    _build_list_key_query_from_markers(prefix, delimiter, key_marker, upload_started_marker, version_seq_marker) {
        if (!key_marker) {
            return this._build_list_key_query_from_prefix(prefix);
        }
        if (!key_marker.startsWith(prefix)) {
            throw new Error(`BAD KEY MARKER ${key_marker} FOR PREFIX ${prefix}`);
        }
        const key_query = { $gt: key_marker };

        // filter keys starting with prefix
        let regexp_text = '^' + _.escapeRegExp(prefix);

        // Optimization:
        // when using delimiter and key_marker ends with delimiter,
        // this means the last iteration ended on a directory, i.e. common prefix,
        // so we can safely skip any objects under that directory,
        // since all these keys have the same common prefix and surely not > key_marker.
        // this is also safe with secondary markers such as upload_started_marker or version_seq_marker,
        // since common prefixes are never assumed to have a secondary marker.
        const key_marker_suffix = key_marker.slice(prefix.length);
        if (delimiter && key_marker_suffix.endsWith(delimiter)) {
            regexp_text += '(?!' + _.escapeRegExp(key_marker_suffix) + ')';
        }
        if (regexp_text !== '^') {
            key_query.$regex = new RegExp(regexp_text);
        }

        if (upload_started_marker) {
            return {
                or_query: [{
                    // this match keys with the last key_marker and next (ascending) upload_started_marker
                    key: key_marker,
                    upload_started: { $gt: upload_started_marker }
                }, {
                    key: key_query
                }]
            };
        }

        if (version_seq_marker) {
            return {
                or_query: [{
                    // this match keys with the last key_marker and next (descending) version_seq_marker
                    key: key_marker,
                    version_seq: { $lt: version_seq_marker }
                }, {
                    key: key_query
                }]
            };
        }

        return { key_query };
    }

    _get_unique_latest_keys(keys) {
        return _.compact(_.map(keys, key => (key.obj ? (!key.obj.version_past && key) : key)));
    }

    async had_any_objects_in_system(system_id) {
        // this is not an optimized query but since we have a single system we dont care for now.
        const obj = await this._objects.col().findOne({ system: system_id });
        return Boolean(obj);
    }

    async has_any_completed_objects_in_bucket(bucket_id) {
        const obj = await this._objects.col().findOne({
            // index fields:
            bucket: bucket_id,
            // prefix for stored blob blocks information. TODO: move somwhere like config.js
            key: { $not: /^\.noobaa_blob_blocks/ },
            // partialFilterExpression:
            deleted: null,
            upload_started: null,
        }, {
            hint: 'version_seq_index',
            sort: { bucket: 1, key: 1, version_seq: -1 },
        });
        return Boolean(obj);
    }

    async count_objects_of_bucket(bucket_id) {
        return this._objects.col().count({
            bucket: bucket_id,
            deleted: null,
            delete_marker: null,
            version_past: null
        });
    }

    async has_any_latest_objects_for_bucket(bucket_id, upload_mode) {
        if (upload_mode === true) return false;
        return this._objects.col().findOne({
                bucket: bucket_id,
                deleted: null,
                delete_marker: null,
                version_past: null
            })
            .then(obj => Boolean(obj));
    }

    async count_objects_per_bucket(system_id) {
        // TODO check which index is needed to cover this aggregation
        const res = await this._objects.col().aggregate([{
            $match: {
                system: system_id,
                deleted: null,
                delete_marker: null,
                version_past: null
            }
        }, {
            $group: {
                _id: '$bucket',
                count: {
                    $sum: 1
                }
            }
        }]).toArray();
        const buckets = {};
        let total_count = 0;
        _.forEach(res, r => {
            buckets[r._id] = r.count;
            total_count += r.count;
        });
        buckets[''] = total_count;
        return buckets;
    }

    async aggregate_objects_by_create_dates(from_time, till_time) {
        return this._aggregate_objects_internal({
            create_time: {
                $gte: new Date(from_time),
                $lt: new Date(till_time),
            }
        });
    }

    async aggregate_objects_by_delete_dates(from_time, till_time) {
        return this._aggregate_objects_internal({
            deleted: {
                $gte: new Date(from_time),
                $lt: new Date(till_time),
            },
            create_time: { $exists: true }
        });
    }

    /**
     * _aggregate_objects_internal - counts the number of objects and sum of sizes,
     * both for the entire query, and per bucket.
     * @return <Object> buckets - each bucket value is an object with properties: size, count.
     *      the '' key represents the entire query and others are bucket ids.
     */
    async _aggregate_objects_internal(query) {
        const res = await this._objects.col().mapReduce(
            mongo_functions.map_aggregate_objects,
            mongo_functions.reduce_sum, {
                query,
                out: { inline: 1 }
            }
        );
        const buckets = {};
        _.forEach(res, r => {
            const b = buckets[r._id[0]] || {};
            buckets[r._id[0]] = b;
            b[r._id[1]] = r.value;
        });
        return buckets;
    }

    async find_deleted_objects(max_delete_time, limit) {
        const objects = await this._objects.col().find({
            deleted: { $lt: new Date(max_delete_time) },
        }, {
            limit: Math.min(limit, 1000),
            fields: {
                _id: 1,
                deleted: 1
            }
        }).toArray();
        return mongo_utils.uniq_ids(objects, '_id');
    }

    async db_delete_objects(object_ids) {
        if (!object_ids || !object_ids.length) return;
        return this._objects.col().deleteMany({
            _id: { $in: object_ids },
            deleted: { $exists: true }
        });
    }

    get_object_version_id({ version_seq, version_enabled }) {
        if (!version_enabled || !version_seq) return 'null';
        return `nbver-${version_seq}`;
    }

    ////////////////
    // MULTIPARTS //
    ////////////////

    insert_multipart(multipart) {
        this._multiparts.validate(multipart);
        return this._multiparts.col().insertOne(multipart);

    }

    update_multipart_by_id(multipart_id, set_updates) {
        return this._multiparts.col().updateOne({
                _id: multipart_id,
            }, compact_updates(set_updates))
            .then(res => mongo_utils.check_update_one(res, 'multipart'));
    }

    find_multipart_by_id(multipart_id) {
        return this._multiparts.col().findOne({
                _id: multipart_id,
            })
            .then(obj => mongo_utils.check_entity_not_deleted(obj, 'multipart'));
    }

    find_multiparts_of_object(obj_id, num_gt, limit) {
        return this._multiparts.col().find({
                obj: obj_id,
                num: { $gt: num_gt },
                size: { $exists: true },
                md5_b64: { $exists: true },
                create_time: { $exists: true },
            }, {
                sort: {
                    num: 1,
                    create_time: -1, // last-completed first
                },
                limit: limit,
            })
            .toArray();
    }

    delete_multiparts_of_object(obj) {
        const delete_date = new Date();
        return this._multiparts.col().updateMany({
            obj: obj._id,
            deleted: null
        }, {
            $set: {
                deleted: delete_date
            },
            $rename: {
                // obj: 'obj_del',
                num: 'num_del',
            }
        });
    }

    delete_multiparts(multiparts) {
        const delete_date = new Date();
        return this._multiparts.col().updateMany({
            _id: { $in: mongo_utils.uniq_ids(multiparts, '_id') },
        }, {
            $set: {
                deleted: delete_date
            },
            $rename: {
                // obj: 'obj_del',
                num: 'num_del',
            }
        });
    }

    db_delete_multiparts_of_object(obj) {
        return this._multiparts.col().deleteMany({
            obj: obj._id,
            deleted: { $exists: true }
        });
    }

    has_any_objects_for_bucket_including_deleted(bucket_id) {
        return this._objects.col().findOne({
                bucket: bucket_id,
            })
            .then(obj => Boolean(obj));
    }

    has_any_objects_for_bucket(bucket_id, upload_mode) {
        let upload_started;
        if (upload_mode === true) {
            upload_started = { $exists: true };
        } else if (upload_mode === false) {
            upload_started = null;
        }

        return this._objects.col().findOne(_.omitBy({
                bucket: bucket_id,
                deleted: null,
                upload_started
            }, _.isUndefined))
            .then(obj => Boolean(obj));
    }

    has_any_uploads_for_bucket(bucket_id) {
        return this._objects.col().findOne({
                bucket: bucket_id,
                deleted: null,
                upload_started: { $exists: true }
            })
            .then(obj => Boolean(obj));
    }


    ///////////
    // PARTS //
    ///////////


    insert_parts(parts) {
        if (!parts || !parts.length) return;
        for (const part of parts) {
            this._parts.validate(part);
        }
        return this._parts.col().insertMany(parts, unordered_insert_options());
    }

    find_parts_by_start_range({ obj_id, start_gte, start_lt, end_gt, skip, limit }) {
        return this._parts.col().find({
                obj: obj_id,
                start: {
                    // since end is not indexed we query start with both
                    // low and high constraint, which allows the index to reduce scan
                    // we use a constant that limits the max part size because
                    // this is the only way to limit the minimal start value
                    $gte: start_gte,
                    $lt: start_lt,
                },
                end: {
                    $gt: end_gt
                },
                deleted: null,
            }, {
                sort: {
                    start: 1
                },
                skip: skip || 0,
                limit: limit || 0,
            })
            .toArray();
    }

    find_parts_chunk_ids(obj) {
        return this._parts.col().find({
                obj: obj._id,
            }, {
                fields: {
                    _id: 0,
                    chunk: 1
                }
            })
            .toArray()
            .then(parts => mongo_utils.uniq_ids(parts, 'chunk'));
    }

    find_parts_by_chunk_ids(chunk_ids) {
        return this._parts.col().find({
                chunk: {
                    $in: chunk_ids
                },
                deleted: null,
            })
            .toArray();
    }

    find_parts_unreferenced_chunk_ids(chunk_ids) {
        return this._parts.col().find({
                chunk: {
                    $in: chunk_ids
                },
                deleted: null,
            }, {
                fields: {
                    _id: 0,
                    chunk: 1
                }
            })
            .toArray()
            .then(parts => {
                const referenced_chunks_ids = mongo_utils.uniq_ids(parts, 'chunk');
                const unreferenced_chunks_ids = mongo_utils.obj_ids_difference(chunk_ids, referenced_chunks_ids);
                dbg.log0('find_object_parts_unreferenced_chunk_ids:',
                    'chunk_ids', chunk_ids.length,
                    'referenced_chunks_ids', referenced_chunks_ids.length,
                    'unreferenced_chunks_ids', unreferenced_chunks_ids.length);
                return unreferenced_chunks_ids;
            });
    }

    find_parts_chunks_references(chunk_ids) {
        return this._parts.col().find({
                chunk: { $in: chunk_ids },
                deleted: null,
            })
            .toArray()
            .then(parts => {
                const parts_by_chunk_id = _.groupBy(parts, 'chunk');
                return parts_by_chunk_id;
            });
    }

    load_parts_objects_for_chunks(chunks) {
        let parts;
        let objects;
        if (!chunks || !chunks.length) return;
        return this._parts.col().find({
                chunk: {
                    $in: mongo_utils.uniq_ids(chunks, '_id')
                }
            })
            .toArray()
            .then(res_parts => {
                parts = res_parts;
                return this._objects.col().find({
                        _id: {
                            $in: mongo_utils.uniq_ids(res_parts, 'obj')
                        }
                    })
                    .toArray();
            })
            .then(res_objects => {
                objects = res_objects;
            })
            .then(() => ({
                parts,
                objects
            }));
    }

    find_parts_of_object(obj) {
        return this._parts.col().find({
                obj: obj._id,
            })
            .toArray();
    }

    update_parts_in_bulk(parts_updates) {
        const bulk = this._parts.col().initializeUnorderedBulkOp();
        for (const update of parts_updates) {
            bulk.find({
                    _id: update._id
                })
                .updateOne({
                    $set: update.set_updates
                });
        }
        return bulk.length ? bulk.execute() : P.resolve();
    }

    delete_parts_of_object(obj) {
        const delete_date = new Date();
        return this._parts.col().updateMany({
            obj: obj._id,
            deleted: null
        }, {
            $set: {
                deleted: delete_date
            },
            $rename: {
                // obj: 'obj_del',
                start: 'start_del',
                // chunk: 'chunk_del',
            }
        });
    }

    delete_parts(parts) {
        const delete_date = new Date();
        return this._parts.col().updateMany({
            _id: { $in: mongo_utils.uniq_ids(parts, '_id') },
        }, {
            $set: {
                deleted: delete_date
            },
            $rename: {
                // obj: 'obj_del',
                start: 'start_del',
                // chunk: 'chunk_del',
            }
        });
    }

    db_delete_parts_of_object(obj) {
        return this._parts.col().deleteMany({
            obj: obj._id,
            deleted: { $exists: true }
        });
    }


    ////////////
    // CHUNKS //
    ////////////

    insert_chunks(chunks) {
        if (!chunks || !chunks.length) return;
        for (const chunk of chunks) {
            this._chunks.validate(chunk);
        }
        return this._chunks.col().insertMany(chunks, unordered_insert_options());
    }

    update_chunk_by_id(chunk_id, set_updates) {
        return this._chunks.col().updateOne({
                _id: chunk_id
            }, compact_updates(set_updates))
            .then(res => mongo_utils.check_update_one(res, 'chunk'));
    }

    update_chunks_by_ids(chunk_ids, set_updates, unset_updates) {
        console.log('update_chunks_by_ids:', chunk_ids, compact_updates(set_updates, unset_updates));
        if (!chunk_ids || !chunk_ids.length) return;
        return this._chunks.col().updateMany({
            _id: {
                $in: chunk_ids
            }
        }, compact_updates(set_updates, unset_updates));
    }

    find_chunks_by_ids(chunk_ids) {
        if (!chunk_ids || !chunk_ids.length) return;
        return this._chunks.col().find({
                _id: {
                    $in: chunk_ids
                }
            })
            .toArray();
    }

    populate_chunks(docs, doc_path, fields) {
        return mongo_utils.populate(docs, doc_path, this._chunks.col(), fields);
    }

    populate_chunks_for_parts(parts) {
        return mongo_utils.populate(parts, 'chunk', this._chunks.col());
    }

    find_chunks_by_dedup_key(bucket, dedup_keys) {
        return this._chunks.col().find({
                system: bucket.system._id,
                bucket: bucket._id,
                dedup_key: {
                    $in: dedup_keys
                },
                deleted: null,
            }, {
                sort: {
                    _id: -1 // get newer chunks first
                }
            })
            .toArray()
            .then(chunks => this.load_blocks_for_chunks(chunks));
    }

    iterate_all_chunks_in_buckets(lower_marker, upper_marker, buckets, limit) {
        return this._chunks.col().find(compact({
                _id: lower_marker ? compact({
                    $gt: lower_marker,
                    $lte: upper_marker
                }) : undefined,
                deleted: null,
                bucket: {
                    $in: buckets
                }
            }), {
                fields: {
                    _id: 1
                },
                sort: {
                    _id: 1
                },
                limit: limit,
            })
            .toArray()
            .then(chunks => ({
                chunk_ids: mongo_utils.uniq_ids(chunks, '_id'),
                marker: chunks.length ? chunks[chunks.length - 1]._id : null,
            }));
    }

    iterate_all_chunks(marker, limit) {
        return this._chunks.col().find(compact({
                _id: marker ? {
                    $lt: marker
                } : undefined,
                deleted: null,
            }), {
                fields: {
                    _id: 1
                },
                sort: {
                    _id: -1
                },
                limit: limit,
            })
            .toArray()
            .then(chunks => ({
                chunk_ids: mongo_utils.uniq_ids(chunks, '_id'),
                marker: chunks.length ? chunks[chunks.length - 1]._id : null,
            }));
    }

    find_oldest_tier_chunk_ids(tier, limit, sort_direction) {
        const sort = {
            tier: sort_direction * -1,
            tier_lru: sort_direction
        };
        return this._chunks.col().find({
                tier,
                deleted: null,
            }, {
                fields: { _id: 1 },
                hint: 'tiering_index',
                sort,
                limit,
            })
            .toArray()
            .then(chunks => mongo_utils.uniq_ids(chunks, '_id'));
    }


    aggregate_chunks_by_create_dates(from_time, till_time) {
        return this._aggregate_chunks_internal({
            _id: {
                $gte: this.make_md_id_from_time(from_time, 'zero_suffix'),
                $lt: this.make_md_id_from_time(till_time, 'zero_suffix'),
            }
        });
    }

    aggregate_chunks_by_delete_dates(from_time, till_time) {
        return this._aggregate_chunks_internal({
            deleted: {
                $gte: new Date(from_time),
                $lt: new Date(till_time),
            }
        });
    }

    _aggregate_chunks_internal(query) {
        return this._chunks.col().mapReduce(
                mongo_functions.map_aggregate_chunks,
                mongo_functions.reduce_sum, {
                    query: query,
                    out: {
                        inline: 1
                    }
                })
            .then(res => {
                const buckets = {};
                _.each(res, r => {
                    const b = buckets[r._id[0]] || {};
                    buckets[r._id[0]] = b;
                    b[r._id[1]] = r.value;
                });
                return buckets;
            });
    }

    delete_chunks_by_ids(chunk_ids) {
        const delete_date = new Date();
        if (!chunk_ids || !chunk_ids.length) return;
        return this._chunks.col().updateMany({
            _id: {
                $in: chunk_ids
            },
            deleted: null
        }, {
            $set: {
                deleted: delete_date
            },
            $unset: {
                dedup_key: true
            }
        });
    }

    delete_object_by_id(object_id) {
        if (!object_id) return;
        return this._objects.col().updateOne({
            _id: object_id,
            deleted: null
        }, {
            $set: {
                deleted: new Date(),
            },
        });
    }

    get_dedup_index_size() {
        return this._chunks.col().stats()
            .then(res => res.indexSizes.dedup_key_1);
    }

    get_aprox_dedup_keys_number() {
        // This function estimates the number of items in the dedup index - it does it by sample 10K chunks - and check how much of them are deduped
        // and then calculates the aproximate number of the total indexed dedup chunks - this was the fastest soultion we found
        // both iterating over the chunks and running a query over all the chunks was too lengthy operations.
        const sample_size = 10000;
        return P.join(
                this._chunks.col().count(),
                this._chunks.col().aggregate([
                    { $sample: { size: sample_size } },
                    { $match: { dedup_key: { $exists: true } } },
                    { $count: "count" }
                ]).toArray()
            )
            .then(([total_count, sample_items]) => {
                if (!sample_items.length) return total_count;
                return Math.floor(sample_items[0].count * total_count / sample_size);
            });
    }

    iterate_indexed_chunks(limit, marker) {
        return this._chunks.col().find({
                dedup_key: marker ? { $lt: marker } : { $exists: true }
            }, {
                fields: {
                    _id: 1,
                    dedup_key: 1
                },
                sort: {
                    dedup_key: -1
                },
                limit: limit,
            })
            .toArray()
            .then(chunks => ({
                chunk_ids: mongo_utils.uniq_ids(chunks, '_id'),
                marker: chunks.length ? chunks[chunks.length - 1].dedup_key : null,
            }));
    }

    find_deleted_chunks(max_delete_time, limit) {
        const query = {
            deleted: {
                $lt: new Date(max_delete_time)
            },
        };
        return this._chunks.col().find(query, {
                limit: Math.min(limit, 1000),
                fields: {
                    _id: 1,
                    deleted: 1
                }
            }).toArray()
            .then(objects => mongo_utils.uniq_ids(objects, '_id'));
    }

    has_any_blocks_for_chunk(chunk_id) {
        return this._blocks.col().findOne({
                chunk: chunk_id,
            })
            .then(obj => Boolean(obj));
    }

    has_any_parts_for_chunk(chunk_id) {
        return this._parts.col().findOne({
                chunk: chunk_id,
            })
            .then(obj => Boolean(obj));
    }

    db_delete_chunks(chunk_ids) {
        if (!chunk_ids || !chunk_ids.length) return;
        return this._chunks.col().deleteMany({
            _id: {
                $in: chunk_ids
            },
            deleted: { $exists: true }
        });
    }

    ////////////
    // BLOCKS //
    ////////////

    iterate_all_blocks(marker, limit, deleted_only) {
        const query = compact({
            _id: marker ? {
                $lt: marker
            } : undefined,
            deleted: null
        });
        if (deleted_only) {
            query.deleted = {
                $exists: true
            };
            query.reclaimed = {
                $exists: false
            };
        }
        return this._blocks.col().find(query, {
                sort: {
                    _id: -1
                },
                limit: limit,
            })
            .toArray();
    }

    insert_blocks(blocks) {
        if (!blocks || !blocks.length) return;
        for (const block of blocks) {
            this._blocks.validate(block);
        }
        return this._blocks.col().insertMany(blocks, unordered_insert_options());
    }

    update_blocks_by_ids(block_ids, set_updates, unset_updates) {
        if (!block_ids || !block_ids.length) return;
        return this._blocks.col().updateMany({
            _id: {
                $in: block_ids
            }
        }, compact_updates(set_updates, unset_updates));
    }

    find_blocks_of_chunks(chunk_ids) {
        if (!chunk_ids || !chunk_ids.length) return;
        return this._blocks.col().find({
                chunk: {
                    $in: chunk_ids
                },
            })
            .toArray()
            .then(blocks => this.populate_nodes_for_blocks(blocks));
    }

    load_blocks_for_chunks(chunks) {
        if (!chunks || !chunks.length) return chunks;
        return this._blocks.col().find({
                chunk: {
                    $in: mongo_utils.uniq_ids(chunks, '_id')
                },
                deleted: null,
            })
            .toArray()
            .then(blocks => this.populate_nodes_for_blocks(blocks))
            .then(blocks => {
                // remove from the list blocks that their node is not found
                // and consider these blocks just like deleted blocks
                const orphan_blocks = _.remove(blocks, block => !block.node || !block.node._id);
                if (orphan_blocks.length) console.log('ORPHAN BLOCKS (ignoring)', orphan_blocks);
                const blocks_by_chunk = _.groupBy(blocks, 'chunk');
                for (let i = 0; i < chunks.length; ++i) {
                    chunks[i].blocks = blocks_by_chunk[chunks[i]._id] || [];
                }
                return chunks;
            });
    }

    populate_nodes_for_blocks(blocks) {
        return nodes_client.instance().populate_nodes_for_map(
            blocks[0] && blocks[0].system, blocks, 'node');
    }

    iterate_node_chunks({ node_id, marker, limit }) {
        return this._blocks.col().find(compact({
                node: node_id,
                _id: marker ? {
                    $lt: marker
                } : undefined,
                deleted: null,
            }), {
                fields: {
                    _id: 1,
                    chunk: 1,
                    size: 1
                },
                sort: {
                    _id: -1 // start with latest blocks and go back
                },
                limit: limit,
            })
            .toArray()
            .then(blocks => ({
                chunk_ids: mongo_utils.uniq_ids(blocks, 'chunk'),
                marker: blocks.length ? blocks[blocks.length - 1]._id : null,
                blocks_size: _.sumBy(blocks, 'size'),
            }));
    }

    iterate_multi_nodes_chunks({ node_ids, skip, limit }) {
        return this._blocks.col().find(compact({
                node: { $in: node_ids },
                deleted: null,
            }), {
                fields: {
                    _id: 1,
                    chunk: 1,
                    size: 1
                },
                sort: {
                    _id: -1 // start with latest blocks and go back
                },
                skip: skip,
                limit: limit,
            })
            .toArray()
            .then(blocks => ({
                chunk_ids: mongo_utils.uniq_ids(blocks, 'chunk'),
                marker: blocks.length ? blocks[blocks.length - 1]._id : null,
                blocks_size: _.sumBy(blocks, 'size'),
            }));
    }

    count_blocks_of_nodes(node_ids) {
        return this._blocks.col().count({
            node: { $in: node_ids },
            deleted: null,
        });
    }

    delete_blocks_of_chunks(chunk_ids) {
        const delete_date = new Date();
        if (!chunk_ids || !chunk_ids.length) return;
        return this._blocks.col().updateMany({
            chunk: {
                $in: chunk_ids
            },
            deleted: null
        }, {
            $set: {
                deleted: delete_date
            },
            // $rename: {
            //     chunk: 'chunk_del',
            //     node: 'node_del',
            // }
        });
    }

    aggregate_blocks_by_create_dates(from_time, till_time) {
        return this._aggregate_blocks_internal({
            _id: {
                $gte: this.make_md_id_from_time(from_time, 'zero_suffix'),
                $lt: this.make_md_id_from_time(till_time, 'zero_suffix'),
            }
        });
    }

    aggregate_blocks_by_delete_dates(from_time, till_time) {
        return this._aggregate_blocks_internal({
            deleted: {
                $gte: new Date(from_time),
                $lt: new Date(till_time),
            }
        });
    }

    _aggregate_blocks_internal(query) {
        return this._blocks.col().mapReduce(
                mongo_functions.map_aggregate_blocks,
                mongo_functions.reduce_sum, {
                    query: query,
                    out: {
                        inline: 1
                    }
                })
            .then(res => {
                const buckets = {};
                const pools = {};
                _.each(res, r => {
                    const type = r._id[0];
                    if (type === 'total') {
                        buckets[r._id[1]] = { size: r.value };
                    } else if (type === 'bucket') {
                        const b = buckets[r._id[1]] || {
                            size: 0,
                            pools: {}
                        };
                        buckets[r._id[1]] = b;
                        b.size = r.value;
                    } else if (type === 'pool') {
                        pools[r._id[1]] = { size: r.value };
                    } else if (type === 'bucket_and_pool') {
                        const b = buckets[r._id[1]] || {
                            size: 0,
                            pools: {}
                        };
                        buckets[r._id[1]] = b;
                        b.pools[r._id[2]] = { size: r.value };
                    }
                });
                return {
                    buckets,
                    pools
                };
            });
    }

    find_deleted_blocks(max_delete_time, limit) {
        const query = {
            deleted: {
                $lt: new Date(max_delete_time)
            },
        };
        return this._blocks.col().find(query, {
                limit: Math.min(limit, 1000),
                fields: {
                    _id: 1,
                    deleted: 1
                }
            }).toArray()
            .then(objects => mongo_utils.uniq_ids(objects, '_id'));
    }

    db_delete_blocks(block_ids) {
        if (!block_ids || !block_ids.length) return;
        return this._blocks.col().deleteMany({
            _id: {
                $in: block_ids
            },
            deleted: { $exists: true }
        });
    }
}

function compact(obj) {
    return _.omitBy(obj, _.isUndefined);
}

function compact_updates(set_updates, unset_updates, inc_updates) {
    const updates = compact({
        $set: set_updates,
        $unset: unset_updates,
        $inc: inc_updates,
    });
    if (_.isEmpty(updates)) throw new Error(`INVALID EMPTY UPDATES`);
    return updates;
}

function unordered_insert_options() {
    return {
        ordered: false
    };
}

function normalize_list_mr_results(mr_results, prefix) {
    return mr_results.map(r => (
        r._id[1] === 'common_prefix' ?
        ({ common_prefix: r.value || 1, key: prefix + r._id[0] }) :
        r.value
    ));
}

function sort_list_objects_with_delimiter(a, b) {
    // key is sorted in ascending order
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
}

function sort_list_versions_with_delimiter(a, b) {
    // key is sorted in ascending order
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    // version_seq is sorted in *** descending *** order
    const a_version = a.version_seq || 0;
    const b_version = b.version_seq || 0;
    if (a_version < b_version) return 1;
    if (a_version > b_version) return -1;
    return 0;
}

function sort_list_uploads_with_delimiter(a, b) {
    // key is sorted in ascending order
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    // upload_started is sorted in ascending order
    const a_upload = a.upload_started ? a.upload_started.getTimestamp().getTime() : 0;
    const b_upload = b.upload_started ? b.upload_started.getTimestamp().getTime() : 0;
    if (a_upload < b_upload) return -1;
    if (a_upload > b_upload) return 1;
    return 0;
}

// EXPORTS
exports.MDStore = MDStore;
