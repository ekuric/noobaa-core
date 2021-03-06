/* Copyright (C) 2016 NooBaa */
"use strict";

const _ = require('lodash');
const request = require('request');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const util = require('util');
const P = require('../../util/promise');
const ec2_wrap = require('../../deploy/ec2_wrapper');
const promise_utils = require('../../util/promise_utils');
const api = require('../../api');

const request_promise = util.promisify(request);

var test_file = '/tmp/test_upgrade';
let rpc_validation_disabled = false;

module.exports = {
    upload_and_upgrade: upload_and_upgrade,
    wait_for_server: wait_for_server,
    get_agent_setup: get_agent_setup,
    upload_file: upload_file,
    download_file: download_file,
    verify_upload_download: verify_upload_download,
    generate_random_file: generate_random_file,
    wait_on_agents_upgrade: wait_on_agents_upgrade,
    calc_md5: calc_md5,
    disable_rpc_validation: disable_rpc_validation
};

function disable_rpc_validation() {
    rpc_validation_disabled = true;
}

function upload_and_upgrade(ip, upgrade_pack, dont_verify_version) {
    console.log('Upgrading the machine');
    rpc_validation_disabled = true; //Running from a new code onto an older code server
    let client = get_rpc_client(ip);
    let previous_srv_version;

    var filename;
    if (upgrade_pack.indexOf('/') === -1) {
        filename = upgrade_pack;
    } else {
        filename = upgrade_pack.substring(upgrade_pack.indexOf('/'));
    }

    var formData = {
        upgrade_file: {
            value: fs.createReadStream(upgrade_pack),
            options: {
                filename: filename,
                contentType: 'application/x-gzip'
            }
        }
    };

    var auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params)
        .then(() => P.ninvoke(request, 'post', {
            url: 'http://' + ip + ':8080/upgrade',
            formData: formData,
            rejectUnauthorized: false,
        }))
        .then(() => {
            let ready = false;
            return promise_utils.pwhile(() => !ready, () => client.system.read_system()
                .then(res => {
                    const upgrade_status = _.get(res, 'cluster.shards.0.servers.0.upgrade.status');
                    console.log(`waiting for upgrade status to be CAN_UPGRADE. current upgrade_status = ${upgrade_status}`);
                    if (upgrade_status === 'CAN_UPGRADE') {
                        previous_srv_version = res.version;
                        ready = true;
                    } else if (upgrade_status === 'FAILED') {
                        console.log('Failed on pre upgrade tests', util.inspect(res.cluster.shards[0].servers));
                        throw new Error('Failed on pre upgrade tests');
                    } else {
                        return P.delay(5000);
                    }
                }));
        })
        .then(() => console.log('Upload package successful'))
        .then(() => client.upgrade.upgrade_cluster())
        .catch(err => {
            // TODO: remove when upgrade_api is merged to base version (version we upgrade from in vitaly)
            if (err.rpc_code === 'NO_SUCH_RPC_SERVICE') {
                console.log('Failed using upgrade.upgrade_cluster, using cluster_internal.upgrade_cluster', err);
                return client.cluster_internal.upgrade_cluster();
            } else {
                throw err;
            }
        })
        .then(() => P.delay(10000))
        .then(() => wait_for_server(ip))
        .then(() => P.delay(10000))
        .then(() => {
            var isNotListening = true;
            return promise_utils.pwhile(
                function() {
                    return isNotListening;
                },
                function() {
                    return P.ninvoke(request, 'get', {
                        url: 'http://' + ip + ':80/',
                        rejectUnauthorized: false,
                    }).then(res => {
                        console.log('S3 server started after upgrade');
                        isNotListening = false;
                    }, err => {
                        console.log('waiting for S3 server to start', err);
                        return P.delay(10000);
                    });
                });
        })
        .then(() => client.system.read_system())
        .then(res => {
            // make sure that upgrade is successful by checking it is marked as completed
            const upgrade_successful = res.cluster.shards[0].servers.every(server => server.upgrade.status === 'COMPLETED');
            if (!upgrade_successful) {
                console.error('some servers did not reach to upgrade COMPLETED status:',
                    res.cluster.shards[0].servers.map(server => server.upgrade));
                throw new Error('not all servers completed upgrade successfully');
            }
            //Server is up, check returned version to verify the server was upgraded
            if (dont_verify_version) {
                console.warn('Skipping version check - probably upgrading to the same version intentionally');
                return;
            }
            if (res.version === previous_srv_version) {
                //Upgrade actually failed
                console.error('Upgrade failed, version did not change');
                throw new Error('Upgrade failed, version did not change');
            }
        })
        .catch(err => {
            console.error('Upload package failed', err, err.stack);
            throw new Error('Upload package failed ' + err);
        });
}

async function wait_for_server(ip, wait_for_version) {
    const url = `http://${ip}:8080/version`;
    for (;;) {
        try {
            console.log('waiting for Web Server to start');
            const { statusCode, body } = await request_promise({
                method: 'get',
                url,
                strictSSL: false,
            });
            if (statusCode !== 200) {
                throw new Error(`wait_for_server: GET ${url} FAILED:` +
                    ` statusCode ${statusCode} body ${body}`);
            }
            if (wait_for_version && body !== wait_for_version) {
                throw new Error(`wait_for_server: version is ${body}` +
                    ` wait for version ${wait_for_version}`);
            }
            console.log('Web Server started. version is: ' + body);
            return body;
        } catch (err) {
            console.log('not up yet...', err.message);
            await P.delay(5000);
        }
    }
}

function get_agent_setup(ip) {
    return P.ninvoke(request, 'get', {
            url: 'https://' + ip + ':8443/public/noobaa-setup.exe',
            rejectUnauthorized: false,
        })
        .then(function(response) {
            console.log('Download of noobaa-setup was successful');

        })
        .then(null, function(err) {
            console.error('Download of noobaa-setup failed', err);
            throw new Error('Download of noobaa-setup failed ' + err);
        });
}

function upload_file(ip, path, bucket, key, timeout, throw_on_error) {
    return P.fcall(function() {
            //verify the 'demo' system exists on the instance
            return ec2_wrap.verify_demo_system(ip);
        })
        .then(function() {
            //upload the file
            return P.fcall(function() {
                    return ec2_wrap.put_object(ip, path, bucket, key, timeout, throw_on_error);
                })
                .then(function() {
                    console.log('Upload file successfully');
                })
                .then(null, function(err) {
                    console.error('Error in upload_file', err);
                    throw new Error('Error in upload_file ' + err);
                });
        })
        .then(null, function(err) {
            console.error('Error in verify_demo_system', err, err.stack);
            throw new Error('Error in verify_demo_system ' + err);
        });
}

function download_file(ip, path) {
    return P.fcall(function() {
            //verify the 'demo' system exists on the instance
            return ec2_wrap.verify_demo_system(ip);
        })
        .then(function() {
            //download the file
            return P.fcall(function() {
                    return ec2_wrap.get_object(ip, path);
                })
                .then(function() {
                    console.log('Download file successfully');

                })
                .then(null, function(err) {
                    console.error('Error in download_file', err);
                    throw new Error('Error in download_file ' + err);
                });
        })
        .then(null, function(err) {
            console.error('Error in verify_demo_system', err);
            throw new Error('Error in verify_demo_system ' + err);
        });
}

function verify_upload_download(ip, path) {
    var orig_md5;
    var down_path = path + '_download';
    return P.resolve(calc_md5(path))
        .then(function(md5) {
            orig_md5 = md5;
            return upload_file(ip, path);
        })
        .catch(function(err) {
            console.warn('Failed to upload file', path, 'with err', err, err.stack);
        })
        .then(function() {
            return download_file(ip, down_path);
        })
        .catch(function(err) {
            console.warn('Failed to download file with err', err, err.stack);
        })
        .then(function() {
            return P.resolve(calc_md5(down_path));
        })
        .then(function(md5) {
            if (md5 === orig_md5) {
                console.log('Original and downloaded file MDs are the same');
                return P.resolve();
            } else {
                console.warn('Original and downloaded file MDs are different');
                return P.reject();
            }
        });
}


function generate_random_file(size_mb, extension) {
    extension = extension || '.dat';
    let ext_regex = /^\.[A-Za-z0-9_]{1,4}$/;
    if (!extension.startsWith('.')) extension = '.' + extension;
    if (!ext_regex.test(extension)) return P.reject();
    var suffix = Date.now() + '.' + Math.round(Math.random() * 1000) + extension;
    var fname = test_file + suffix;
    var dd_cmd;

    if (os.type() === 'Darwin') {
        dd_cmd = 'dd if=/dev/urandom of=' + fname + ' count=' + size_mb + ' bs=1m';
    } else if (os.type() === 'Linux') {
        dd_cmd = 'dd if=/dev/urandom of=' + fname + ' count=' + size_mb + ' bs=1M';
    }

    return promise_utils.exec(dd_cmd)
        .then(function() {
            return fname;
        });
}

function get_rpc_client(ip) {
    let rpc = api.new_rpc();
    if (rpc_validation_disabled) {
        rpc.disable_validation();
    }
    let client = rpc.new_client({
        address: 'ws://' + ip + ':8080'
    });
    return client;
}

function wait_on_agents_upgrade(ip) {
    const client = get_rpc_client(ip);
    var sys_ver;

    return P.fcall(function() {
            var auth_params = {
                email: 'demo@noobaa.com',
                password: 'DeMo1',
                system: 'demo'
            };
            return client.create_auth_token(auth_params);
        })
        .then(function() {
            return P.resolve(client.system.read_system({}))
                .then(function(res) {
                    sys_ver = res.version;
                });
        })
        .catch(function(error) {
            console.warn('Failed with', error, error.stack);
            throw error;
        })
        .then(function() {
            //Loop on list_agents until all agents version was updated
            //Timeout at 10 minutes
            var old_agents = true;
            var wait_time = 0;
            return P.delay(5000).then(function() {
                return promise_utils.pwhile(
                    function() {
                        return old_agents;
                    },
                    function() {
                        return P.resolve(client.node.list_nodes({
                                query: {
                                    online: true,
                                }
                            }))
                            .then(function(res) {
                                old_agents = false;
                                _.each(res.nodes, function(n) {
                                    if (n.version !== sys_ver) {
                                        old_agents = true;
                                    }
                                });
                                if (old_agents) {
                                    if (wait_time >= 120) {
                                        throw new Error('Timeout while waiting for agents to upgrade');
                                    }
                                    console.log('waiting for agents to upgrade');
                                    wait_time += 5;
                                    return P.delay(5000);
                                }
                            });
                    });
            });
        });
}

function calc_md5(path) {
    var hash = crypto.createHash('md5');
    var stream = fs.createReadStream(path);

    stream.on('data', function(data) {
        hash.update(data, 'utf8');
    });

    stream.on('end', function() {
        return P.resolve(hash.digest('hex'));
    });
}
