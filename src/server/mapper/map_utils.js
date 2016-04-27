'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var db = require('../db');
// var js_utils = require('../../util/js_utils');
var config = require('../../../config.js');
var dbg = require('../../util/debug_module')(__filename);
var system_store = require('../stores/system_store');
var nodes_store = require('../stores/nodes_store');

module.exports = {
    get_chunk_status: get_chunk_status,
    set_chunk_frags_from_blocks: set_chunk_frags_from_blocks,
    get_missing_frags_in_chunk: get_missing_frags_in_chunk,
    is_block_good: is_block_good,
    is_block_accessible: is_block_accessible,
    is_chunk_good: is_chunk_good,
    is_chunk_accessible: is_chunk_accessible,
    get_part_info: get_part_info,
    get_chunk_info: get_chunk_info,
    get_frag_info: get_frag_info,
    get_block_info: get_block_info,
    get_block_md: get_block_md,
    get_frag_key: get_frag_key,
    sanitize_object_range: sanitize_object_range,
    find_consecutive_parts: find_consecutive_parts,
    block_access_sort: block_access_sort,
};

const EMPTY_CONST_ARRAY = Object.freeze([]);


function get_chunk_status(chunk, tiering, ignore_cloud_pools) {
    // TODO handle multi-tiering
    if (tiering.tiers.length !== 1) {
        throw new Error('analyze_chunk: ' +
            'tiering policy must have exactly one tier and not ' +
            tiering.tiers.length);
    }
    const tier = tiering.tiers[0].tier;
    // when allocating blocks for upload we want to ignore cloud_pools
    // so the client is not blocked until all blocks are uploded to the cloud.
    // on build_chunks flow we will not ignore cloud pools.
    const participating_pools = ignore_cloud_pools ?
        _.filter(tier.pools, pool => _.isUndefined(pool.cloud_pool_info)) :
        tier.pools;
    const tier_pools_by_id = _.keyBy(participating_pools, '_id');
    const replicas = tier.replicas;
    const now = Date.now();

    let missing_frags = get_missing_frags_in_chunk(chunk, tier);
    if (missing_frags && missing_frags.length) {
        console.error('get_chunk_status: missing fragments', chunk, missing_frags);
        throw new Error('get_chunk_status: missing fragments');
    }

    let allocations = [];
    let deletions = [];
    let chunk_accessible = true;


    function check_blocks_group(blocks, alloc) {
        let required_replicas = replicas;
        if (alloc.pools[0].cloud_pool_info) {
            // for cloud_pools we only need one replica
            required_replicas = 1;
        }
        let num_good = 0;
        let num_accessible = 0;
        _.each(blocks, block => {
            if (is_block_accessible(block, now)) {
                num_accessible += 1;
            }
            if (num_good < required_replicas &&
                is_block_good(block, now, tier_pools_by_id)) {
                num_good += 1;
            } else {
                deletions.push(block);
            }
        });
        if (alloc) {
            let num_missing = Math.max(0, required_replicas - num_good);
            _.times(num_missing, () => allocations.push(_.clone(alloc)));
        }
        return num_accessible;
    }

    _.each(chunk.frags, f => {

        dbg.log1('get_chunk_status:', 'chunk', chunk, 'fragment', f);

        let blocks = f.blocks || EMPTY_CONST_ARRAY;
        let num_accessible = 0;

        if (tier.data_placement === 'MIRROR') {
            let blocks_by_pool = _.groupBy(blocks, block => block.node.pool);
            _.each(participating_pools, pool => {
                num_accessible += check_blocks_group(blocks_by_pool[pool._id], {
                    pools: [pool],
                    fragment: f
                });
                delete blocks_by_pool[pool._id];
            });
            _.each(blocks_by_pool, blocks => check_blocks_group(blocks, null));

        } else { // SPREAD
            let pools_partitions = _.partition(participating_pools, pool => _.isUndefined(pool.cloud_pool_info));
            num_accessible += check_blocks_group(blocks, {
                pools: pools_partitions[0], // only spread data on regular pools, and not cloud_pools
                fragment: f
            });
            if (pools_partitions[1].length > 0) {
                let blocks_by_pool = _.groupBy(blocks, block => block.node.pool);
                //now mirror to cloud_pools:
                _.each(pools_partitions[1], cloud_pool => {
                    num_accessible += check_blocks_group(blocks_by_pool[cloud_pool._id], {
                        pools: [cloud_pool],
                        fragment: f
                    });
                });
            }
        }

        if (!num_accessible) {
            chunk_accessible = false;
        }
    });

    return {
        allocations: allocations,
        deletions: deletions,
        accessible: chunk_accessible,
    };
}

function set_chunk_frags_from_blocks(chunk, blocks) {
    let blocks_by_frag_key = _.groupBy(blocks, get_frag_key);
    chunk.frags = _.map(blocks_by_frag_key, blocks => {
        let f = _.pick(blocks[0],
            'layer',
            'layer_n',
            'frag',
            'size',
            'digest_type',
            'digest_b64');
        // sorting the blocks to have most available node on front
        // TODO add load balancing (maybe random the order of good blocks)
        // TODO need stable sorting here for parallel decision making...
        blocks.sort(block_access_sort);
        f.blocks = blocks;
        return f;
    });
}

function get_missing_frags_in_chunk(chunk, tier) {
    let missing_frags;
    let fragments_by_frag_key = _.keyBy(chunk.frags, get_frag_key);
    // TODO handle parity fragments
    _.times(tier.data_fragments, frag => {
        let f = {
            layer: 'D',
            frag: frag,
        };
        let frag_key = get_frag_key(f);
        if (!fragments_by_frag_key[frag_key]) {
            missing_frags = missing_frags || [];
            missing_frags.push(f);
        }
    });
    return missing_frags;
}

function is_block_good(block, now, tier_pools_by_id) {
    if (!is_block_accessible(block, now)) {
        return false;
    }
    // detect nodes that do not belong to the tier pools
    // to be deleted once they are not needed as source
    if (!tier_pools_by_id[block.node.pool]) {
        return false;
    }
    // detect nodes that are full in terms of free space policy
    // to be deleted once they are not needed as source
    if (block.node.storage.free <= config.NODES_FREE_SPACE_RESERVE) {
        return false;
    }
    return true;
}

function is_block_accessible(block, now) {
    var since_hb = now - block.node.heartbeat.getTime();
    if (since_hb > config.SHORT_GONE_THRESHOLD ||
        since_hb > config.LONG_GONE_THRESHOLD) {
        return false;
    }
    if (block.node.srvmode &&
        block.node.srvmode !== 'decommissioning') {
        return false;
    }
    return true;
}

function is_chunk_good(chunk, tiering) {
    let status = get_chunk_status(chunk, tiering);
    return status.accessible && !status.allocations.length;
}

function is_chunk_accessible(chunk, tiering) {
    let status = get_chunk_status(chunk, tiering);
    return status.accessible;
}


function get_part_info(part, adminfo) {
    let p = _.pick(part,
        'start',
        'end',
        'part_sequence_number',
        'upload_part_number',
        'chunk_offset');
    p.chunk = get_chunk_info(part.chunk, adminfo);
    return p;
}

function get_chunk_info(chunk, adminfo) {
    let c = _.pick(chunk,
        'size',
        'digest_type',
        'digest_b64',
        'compress_type',
        'compress_size',
        'cipher_type',
        'cipher_key_b64',
        'cipher_iv_b64',
        'cipher_auth_tag_b64',
        'data_frags',
        'lrc_frags');
    c.frags = _.map(chunk.frags, f => get_frag_info(f, adminfo));
    if (adminfo) {
        c.adminfo = {};
        let bucket = system_store.data.get_by_id(chunk.bucket);
        let status = get_chunk_status(chunk, bucket.tiering);
        if (!status.accessible) {
            c.adminfo.health = 'unavailable';
        } else if (status.allocations.length) {
            c.adminfo.health = 'building';
        } else {
            c.adminfo.health = 'available';
        }
    }
    return c;
}


function get_frag_info(fragment, adminfo) {
    let f = _.pick(fragment,
        'layer',
        'layer_n',
        'frag',
        'size',
        'digest_type',
        'digest_b64');
    f.blocks = _.map(fragment.blocks, block => get_block_info(block, adminfo));
    return f;
}


function get_block_info(block, adminfo) {
    var ret = {
        block_md: get_block_md(block),
    };
    var node = block.node;
    if (adminfo) {
        var pool = system_store.data.get_by_id(node.pool);
        ret.adminfo = {
            pool_name: pool.name,
            node_name: node.name,
            node_ip: node.ip,
            online: nodes_store.is_online_node(node),
        };
        if (node.srvmode) {
            ret.adminfo.srvmode = node.srvmode;
        }
    }
    return ret;
}

function get_block_md(block) {
    var b = _.pick(block, 'size', 'digest_type', 'digest_b64');
    b.id = block._id.toString();
    b.address = block.node.rpc_address;
    b.node = block.node._id.toString();
    return b;
}

function get_frag_key(f) {
    return f.layer + '-' + f.frag;
}

// sanitizing start & end: we want them to be integers, positive, up to obj.size.
function sanitize_object_range(obj, start, end) {
    if (typeof(start) === 'undefined') {
        start = 0;
    }
    // truncate end to the actual object size
    if (typeof(end) !== 'number' || end > obj.size) {
        end = obj.size;
    }
    // force integers
    start = Math.floor(start);
    end = Math.floor(end);
    // force positive
    if (start < 0) {
        start = 0;
    }
    // quick check for empty range
    if (end <= start) {
        return;
    }
    return {
        start: start,
        end: end,
    };
}

function find_consecutive_parts(obj, parts) {
    var start = parts[0].start;
    var end = parts[parts.length - 1].end;
    var upload_part_number = parts[0].upload_part_number;
    var pos = start;
    _.each(parts, function(part) {
        if (pos !== part.start) {
            throw new Error('expected parts to be consecutive');
        }
        if (upload_part_number !== part.upload_part_number) {
            throw new Error('expected parts to have same upload_part_number');
        }
        pos = part.end;
    });
    return P.when(db.ObjectPart.collection.find({
        system: obj.system,
        obj: obj._id,
        upload_part_number: upload_part_number,
        start: {
            // since end is not indexed we query start with both
            // low and high constraint, which allows the index to reduce scan
            $gte: start,
            $lte: end
        },
        end: {
            $lte: end
        },
        deleted: null
    }, {
        sort: 'start'
    }).toArray()).then(function(res) {
        console.log('find_consecutive_parts:', res, 'start', start, 'end', end);
        return res;
    });
}


/**
 * sorting function for sorting blocks with most recent heartbeat first
 */
function block_access_sort(block1, block2) {
    if (block1.node.srvmode) {
        return 1;
    }
    if (block2.node.srvmode) {
        return -1;
    }
    return block2.node.heartbeat.getTime() - block1.node.heartbeat.getTime();
}