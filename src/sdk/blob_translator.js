/* Copyright (C) 2016 NooBaa */
'use strict';

const path = require('path');
const _ = require('lodash');

const dbg = require('../util/debug_module')(__filename);
const P = require('../util/promise');
const BlobError = require('../endpoint/blob/blob_errors').BlobError;



const BLOCKS_INFO_PATH = '.noobaa_blob_blocks';


function get_uncommitted_blocks_path(key) {
    return path.join(BLOCKS_INFO_PATH, key, 'uncommitted');
}

function get_committed_blocks_path(key) {
    return path.join(BLOCKS_INFO_PATH, key, 'committed_blocks');
}

async function upload_blob_block(params, object_sdk) {
    // use the path .noobaa_blob_blocks/KEY/uncommitted to store data of uncommited blocks
    const block_key = path.join(get_uncommitted_blocks_path(params.key), params.blockid);
    return object_sdk.upload_object({
        bucket: params.bucket,
        key: block_key,
        source_stream: params.source_stream,
        size: params.size,
    });
}




async function get_committed_list(params, object_sdk) {
    return [];
}

async function get_uncommitted_list(params, object_sdk) {
    const uncommitted_path = get_uncommitted_blocks_path(params.key);
    const obj_list = [];
    let next_marker;
    let is_truncated = true;

    while (is_truncated) {
        const list_res = await object_sdk.list_objects({
            bucket: params.bucket,
            prefix: uncommitted_path,
            key_marker: next_marker,
        });
        obj_list.push(list_res.objects);
        next_marker = list_res.next_marker;
        is_truncated = list_res.is_truncated;
    }
    return _.flatten(obj_list).map(obj => ({
        key: obj.key.replace(uncommitted_path + '/', '')
    }));
}



async function apply_uncommitted_block(params, object_sdk) {
    const block_key = path.join(get_uncommitted_blocks_path(params.key), params.block.blockid);
    const multipart_params = {
        obj_id: params.obj_id,
        bucket: params.bucket,
        key: params.key,
        num: params.block.num,
        copy_source: {
            bucket: params.bucket,
            key: block_key,
        }
    };
    console.log(`DZDZ: calling upload_multipart with params:`, multipart_params);
    const { etag } = await object_sdk.upload_multipart(multipart_params);
    params.block.etag = etag;
}

async function apply_committed_block(block) {
    // const block_key = get_uncommitted_blocks_path(block.blockid);
    // try {
    //     await object_sdk.
    // } catch (error) {

    // }
}


// verify that uncommitted/committed blocks are in the requested list, and set "latest" blocks to the correct list
function verify_and_fix_block_list(block_list, uncommitted_list, committed_list) {
    for (const block of block_list) {
        switch (block.type) {
            case 'uncommitted':
                if (!uncommitted_list.find(item => item.key === block.blockid)) {
                    dbg.error(`could not find block_id ${block.blockid} in uncommitted list`);
                    throw new BlobError(BlobError.InvalidBlobOrBlock);
                }
                break;
            case 'committed':
                if (!committed_list.find(item => item.key === block.blockid)) {
                    dbg.error(`could not find block_id ${block.blockid} in committed list`);
                    throw new BlobError(BlobError.InvalidBlobOrBlock);
                }
                break;
            case 'latest':
                // first look in the uncommited list
                if (uncommitted_list.includes(block.blockid)) {
                    block.type = 'uncommitted';
                } else if (committed_list.includes(block.blockid)) {
                    block.type = 'committed';
                } else {
                    dbg.error(`could not find block_id ${block.blockid} in uncommitted or committed list`);
                    throw new BlobError(BlobError.InvalidBlobOrBlock);
                }
                break;
            default:
                break;
        }
    }
}


async function commit_blob_block_list(params, object_sdk) {
    dbg.log0(`creating multipart upload for bucket:${params.bucket}, key:${params.key}`);
    const { obj_id } = await object_sdk.create_object_upload({
        bucket: params.bucket,
        key: params.key,
        content_type: params.content_type,
        xattr: params.xattr
        // TODO: check more params to send
    });
    dbg.log0(`got obj_id = ${obj_id}`);
    const [committed_list, uncommitted_list] = await P.all([
        get_committed_list(params, object_sdk),
        get_uncommitted_list(params, object_sdk)
    ]);

    verify_and_fix_block_list(params.block_list, uncommitted_list, committed_list);


    await P.map(params.block_list, block => {
        switch (block.type) {
            case 'uncommitted':
                return apply_uncommitted_block({
                    block,
                    obj_id,
                    key: params.key,
                    bucket: params.bucket
                }, object_sdk);
            case 'committed':
                return apply_committed_block({
                    block,
                    obj_id,
                    key: params.key,
                    bucket: params.bucket
                }, object_sdk);
            default:
                throw new Error('unknown block type');
        }
    }, { concurrency: 10 });

    const multiparts = params.block_list.map(block => ({ num: block.num, etag: block.etag }));
    console.log(`DZDZ: completing multiparts:`, multiparts);
    return object_sdk.complete_object_upload({
        obj_id,
        bucket: params.bucket,
        key: params.key,
        multiparts
    });
}



exports.upload_blob_block = upload_blob_block;
exports.commit_blob_block_list = commit_blob_block_list;
