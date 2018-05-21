/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const blob_utils = require('../blob_utils');
const http_utils = require('../../../util/http_utils');


/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/put-block
 */
async function put_blob_blocklist(req, res) {

    const block_list = _.get(req.body, 'BlockList.$$')
        .map((block, i) => ({ blockid: block._, type: block['#name'].toLowerCase(), num: i + 1 }));
    console.log(`DZDZ: got block_list:`, block_list);

    const reply = await req.object_sdk.commit_blob_block_list({
        bucket: req.params.bucket,
        key: req.params.key,
        content_type: req.headers['x-ms-blob-content-type'],
        list_size: req.content_length >= 0 ? req.content_length : undefined,
        md5_b64: req.content_md5 ? req.content_md5.toString('base64') : undefined,
        sha256_b64: req.content_sha256_buf ? req.content_sha256_buf.toString('base64') : undefined,
        md_conditions: http_utils.get_md_conditions(req),
        xattr: blob_utils.get_request_xattr(req),
        block_list
    });

    res.setHeader('ETag', `"${reply.etag}"`);
    res.statusCode = 201;
}

module.exports = {
    handler: put_blob_blocklist,
    body: {
        type: 'xml',
        // The Put Block List operation enforces the order in which blocks are to be combined to create a blob
        // preserv the order when parsing the xml
        preserve_order: true
    },
    reply: {
        type: 'empty',
    },
};
