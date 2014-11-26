// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var path = require('path');
var utilitest = require('noobaa-util/utilitest');
var rimraf = require('rimraf');
var Semaphore = require('noobaa-util/semaphore');
var api = require('../api');
var db = require('../server/db');
var Agent = require('../agent/agent');

// better stack traces for promises
// used for testing only to avoid its big mem & cpu overheads
// Q.longStackSupport = true;

process.env.JWT_SECRET = 'coretest';

var account_credentials = {
    email: 'coretest@core.test',
    password: 'coretest',
};

var auth_server = require('../server/auth_server');
var account_server = require('../server/account_server');
var system_server = require('../server/system_server');
var node_server = require('../server/node_server');
var object_server = require('../server/object_server');

var auth_client = new api.auth_api.Client();
var account_client = new api.account_api.Client();
var system_client = new api.system_api.Client();
var node_client = new api.node_api.Client();
var object_client = new api.ObjectClient();


before(function(done) {
    Q.fcall(
        function() {
            utilitest.router.use(auth_server.authorize());
            auth_server.install_rest(utilitest.router);
            account_server.install_rest(utilitest.router);
            system_server.install_rest(utilitest.router);
            node_server.install_rest(utilitest.router);
            object_server.install_rest(utilitest.router);

            // setting the port globally for all the clients
            auth_client.set_global_option('port', utilitest.http_port());

            var account_params = _.clone(account_credentials);
            account_params.name = 'coretest';
            return account_client.create_account(account_params);
        }
    ).then(
        function() {
            return create_auth();
        }
    ).nodeify(done);
});

after(function() {
    auth_server.disable_rest();
    account_server.disable_rest();
    system_server.disable_rest();
    node_server.disable_rest();
    object_server.disable_rest();
});

function create_auth(options) {
    var params = _.extend({}, account_credentials, options);
    return auth_client.create_auth(params).then(
        function(res) {
            auth_client.set_global_authorization(res.token);
        }
    );
}

var test_agents;
var agent_storage_dir = path.resolve(__dirname, '../../test_data/coretest');


// create some test nodes named 0, 1, 2, ..., count
function init_test_nodes(count, allocated_storage) {
    var sem = new Semaphore(3);

    function init_test_node(i) {
        return Q.fcall(
            function() {
                return node_client.create_node({
                    name: '' + i,
                    geolocation: 'test',
                    allocated_storage: allocated_storage,
                });
            }
        ).then(
            function() {
                var agent = new Agent({
                    account_client: account_client,
                    node_client: node_client,
                    account_credentials: account_credentials,
                    node_name: '' + i,
                    node_geolocation: 'test',
                    storage_path: agent_storage_dir,
                });
                return agent.start().thenResolve(agent);
            }
        );
    }

    return clear_test_nodes().then(
        function() {
            return Q.all(_.times(count, function(i) {
                return sem.surround(function() {
                    return init_test_node(i);
                });
            }));
        }
    ).then(
        function(agents) {
            test_agents = agents;
        }
    );
}

// delete all edge nodes directly from the db
function clear_test_nodes() {
    return Q.fcall(
        function() {
            console.log('REMOVE NODES');
            var warning_timeout = setTimeout(function() {
                console.log(
                    '\n\n\nWaiting too long?\n\n',
                    'the test got stuck on db.Node.remove().',
                    'this is known when running in mocha standalone (root cause unknown).',
                    'it does work fine when running with gulp, so we let it be.\n\n');
                process.exit(1);
            }, 3000);
            return Q.when(db.Node.remove().exec())['finally'](
                function() {
                    clearTimeout(warning_timeout);
                }
            );
        }
    ).then(
        function() {
            if (!test_agents) {
                return;
            }
            console.log('STOPING AGENTS');
            var sem = new Semaphore(3);
            return Q.all(_.map(test_agents,
                function(agent) {
                    return sem.surround(function() {
                        console.log('agent stop', agent.node_name);
                        return agent.stop();
                    });
                }
            )).then(
                function() {
                    test_agents = null;
                }
            );
        }
    ).then(
        function() {
            console.log('RIMRAF', agent_storage_dir);
            return Q.nfcall(rimraf, agent_storage_dir);
        }
    );
}



module.exports = {
    utilitest: utilitest,
    router: utilitest.router,
    http_port: utilitest.http_port, // function

    auth_client: auth_client,
    account_credentials: account_credentials,
    create_auth: create_auth,

    account_client: account_client,
    system_client: system_client,
    node_client: node_client,
    object_client: object_client,

    init_test_nodes: init_test_nodes,
    clear_test_nodes: clear_test_nodes,
};
