/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const yaml = require('js-yaml');
const fs = require('fs');

const server_rpc = require('../server_rpc');
const P = require('../../util/promise');
const fs_utils = require('../../util/fs_utils');
const config = require('../../../config.js');
const SupervisorCtl = require('./supervisor_ctrl');
const mongo_client = require('../../util/mongo_client');
const dotenv = require('../../util/dotenv');
const dbg = require('../../util/debug_module')(__filename);
const cutil = require('./clustering_utils');
const promise_utils = require('../../util/promise_utils');

class MongoCtrl {


    constructor() {
        //Empty Constructor
    }


    init() {
        dbg.log0('Initing MongoCtrl');
        dotenv.load();
        return this._refresh_services_list();
    }


    //TODO:: for detaching: add remove member from replica set & destroy shard
    add_replica_set_member(name, first_server, servers) {
        let self = this;
        return self._remove_single_mongo_program()
            .then(() => self._update_config_file_for_rs_member(name, first_server))
            .then(() => SupervisorCtl.restart('mongo_wrapper'))
            .then(() => {
                if (first_server) {
                    self._init_replica_set_from_shell(cutil.extract_servers_ip(servers)[0]);
                }
            })
            .then(() =>
                // build new connection url for mongo and write to .env
                self.update_dotenv(name, cutil.extract_servers_ip(servers)));
    }


    add_new_shard_server(name, first_shard) {
        let self = this;
        return self._remove_single_mongo_program()
            .then(() => self._add_new_shard_program(name, first_shard))
            .then(() => SupervisorCtl.apply_changes())
            .delay(5000); // TODO: find better solution;
    }


    add_new_mongos(cfg_array) {
        let self = this;
        return P.resolve()
            .then(() => self._add_new_mongos_program(cfg_array))
            .then(() => SupervisorCtl.apply_changes())
            .delay(5000); // TODO: find better solution
    }


    add_new_config() {
        let self = this;
        return self._add_new_config_program()
            .then(() => SupervisorCtl.apply_changes())
            .delay(5000); // TODO: find better solution
    }


    initiate_replica_set(set, members, is_config_set) {
        dbg.log0('Initiate replica set', set, members, 'is_config_set', is_config_set);
        return mongo_client.instance().initiate_replica_set(set, members, is_config_set);
    }


    add_member_to_replica_set(set, members, is_config_set) {
        dbg.log0('Add members replica set', set, members, is_config_set);
        return mongo_client.instance().replica_update_members(set, members, is_config_set);
    }


    add_member_shard(name, ip) {
        dbg.log0('Add member shard', name, ip);
        return mongo_client.instance().add_shard(ip, config.MONGO_DEFAULTS.SHARD_SRV_PORT, name);
    }


    is_master(is_config_set) {
        var mongo_res;
        return mongo_client.instance().get_mongo_rs_status({
                is_config_set: is_config_set,
            })
            .then(res => {
                mongo_res = res;
                let topo = cutil.get_topology();
                let res_master = false;
                let master_address = '127.0.0.1';
                _.forEach(mongo_res.members, member => {
                    if (member.stateStr === 'PRIMARY') {
                        master_address = member.name.substring(0, member.name.indexOf(':'));
                        if (topo.owner_address === master_address) {
                            res_master = true;
                        }
                    }
                });
                return {
                    ismaster: res_master,
                    rs_status: mongo_res,
                    master_address: master_address
                };
            });
    }


    redirect_to_cluster_master() {
        return mongo_client.instance().get_mongo_rs_status()
            .then(mongo_res => {
                let res_address;
                _.forEach(mongo_res.members, member => {
                    if (member.stateStr === 'PRIMARY') {
                        res_address = member.name.substring(0, member.name.indexOf(':'));
                    }
                });
                return res_address;
            });
    }


    update_connection_string() {
        //Disconnect mongo_client, replace url, connect again
        mongo_client.instance().disconnect();
        mongo_client.instance().update_connection_string();
        return mongo_client.instance().connect();
    }


    get_hb_rs_status() {
        return mongo_client.instance().get_mongo_rs_status()
            .then(status => {
                dbg.log0('got rs status from mongo:', status);
                if (status.ok) {
                    // return rs status fields specified in HB schema (cluster_schema)
                    let rs_status = {
                        set: status.set,
                        members: status.members.map(member => {
                            let member_status = {
                                name: member.name,
                                health: member.health,
                                uptime: member.uptime,
                                stateStr: member.stateStr
                            };
                            if (member.syncingTo) {
                                member_status.syncingTo = member.syncingTo;
                            }
                            return member_status;
                        })
                    };
                    return rs_status;
                }
            });
    }


    add_mongo_monitor_program() {
        let program_obj = {};
        program_obj.name = 'mongo_monitor';
        program_obj.stopsignal = 'KILL';
        program_obj.killasgroup = 'true';
        program_obj.stopasgroup = 'true';
        program_obj.autostart = 'true';
        program_obj.directory = '/root/node_modules/noobaa-core';
        program_obj.command = '/usr/local/bin/node src/server/mongo_services/mongo_monitor.js';
        dbg.log0('adding mongo_monitor program:', program_obj);
        return SupervisorCtl.add_program(program_obj)
            .then(() => SupervisorCtl.apply_changes());
    }


    update_dotenv(name, IPs) {
        if (!process.env.MONGO_SSL_USER) {
            throw new Error('MONGO_SSL_USER is missing in .env');
        }
        let user_name = encodeURIComponent(process.env.MONGO_SSL_USER) + '@';
        dbg.log0('will update dotenv for replica set', name, 'with IPs', IPs);
        let servers_str = IPs.map(ip => ip + ':' + config.MONGO_DEFAULTS.SHARD_SRV_PORT).join(',');
        let url = 'mongodb://' + user_name + servers_str + '/nbcore?replicaSet=' + name +
            '&readPreference=primaryPreferred&authMechanism=MONGODB-X509';
        let old_url = process.env.MONGO_RS_URL || '';
        dbg.log0('updating MONGO_RS_URL in .env from', old_url, 'to', url);
        dotenv.set({
            key: 'MONGO_RS_URL',
            value: url
        });
        // update all processes in the current server of the change in connection string
        return this._publish_rs_name_current_server({
            rs_name: name,
            skip_load_system_store: true
        });
    }


    update_wrapper_sys_check() {
        let new_mongo_wrapper = _.clone(_.find(this._mongo_services, prog => prog.name === 'mongo_wrapper'));
        new_mongo_wrapper.command = new_mongo_wrapper.command.replace(new RegExp('mongod'), 'mongod --testsystem ');
        return this._remove_single_mongo_program()
            .then(() => SupervisorCtl.add_program(new_mongo_wrapper))
            .then(() => SupervisorCtl.apply_changes());
    }


    set_debug_level(level) {
        return mongo_client.instance().set_debug_level(level);
    }


    //
    //Internals
    //

    _update_config_file_for_rs_member(name, first_server) {
        if (!name) {
            throw new Error('port and name must be supplied to add new shard');
        }
        const dbpath = config.MONGO_DEFAULTS.COMMON_PATH + '/' + name + (first_server ? '' : 'rs');
        let config_obj = {
            storage: {
                dbPath: dbpath
            },
            net: {
                port: 27017,
                ssl: {
                    mode: 'requireSSL',
                    allowInvalidHostnames: true,
                    CAFile: config.MONGO_DEFAULTS.ROOT_CA_PATH,
                    PEMKeyFile: config.MONGO_DEFAULTS.SERVER_CERT_PATH,
                    ClusterFile: config.MONGO_DEFAULTS.SERVER_CERT_PATH,
                }
            },
            security: {
                clusterAuthMode: 'x509'
            },
            auditLog: {
                destination: 'syslog'
            },
            systemLog: {
                syslogFacility: 'local0'
            }
        };
        dbg.log0('update mongo config for replica set ', name);
        return P.resolve()
            .then(() => {
                if (!first_server) {
                    return fs_utils.create_fresh_path(dbpath);
                }
            })
            .then(() => {
                const config_data = '# Copyright (C) 2017 NooBaa - mongodb configuration file for a replica set member\n' + yaml.safeDump(config_obj);
                return fs.writeFileAsync(config.MONGO_DEFAULTS.MONGO_CONFIG_FILE, config_data);
            });
    }


    _add_new_shard_program(name, first_shard) {
        if (!name) {
            throw new Error('port and name must be supplied to add new shard');
        }
        var program_obj = {};
        let dbpath = config.MONGO_DEFAULTS.COMMON_PATH + '/' + name;
        program_obj.name = 'mongoshard-' + name;
        program_obj.command = 'mongod  --shardsvr' +
            ' --replSet ' + name +
            ' --port ' + config.MONGO_DEFAULTS.SHARD_SRV_PORT +
            ' --dbpath ' + dbpath +
            ' --syslog ' +
            ' --syslogFacility local0';
        program_obj.directory = '/usr/bin';
        program_obj.user = 'root';
        program_obj.autostart = 'true';
        program_obj.priority = '1';
        if (first_shard) {
            //use the original server`s data (i.e. dbpath/shard1)
            return SupervisorCtl.add_program(program_obj);
        } else {
            return fs_utils.create_fresh_path(dbpath)
                .then(() => SupervisorCtl.add_program(program_obj));
        }
    }


    _add_new_mongos_program(cfg_array) {
        let config_string = '';
        //Mongos can only recieve an odd numbered config IPs, in case we are at 2, use the first one only
        if (cfg_array.length < 3) {
            config_string = cfg_array[0] + ':' + config.MONGO_DEFAULTS.CFG_PORT;
        } else {
            _.each(cfg_array, function(srv) {
                if (config_string !== '') {
                    config_string += ',';
                }
                config_string += srv + ':' + config.MONGO_DEFAULTS.CFG_PORT;
            });
        }
        let program_obj = {};
        program_obj.name = 'mongos';
        program_obj.command = 'mongos --configdb ' + config_string;
        program_obj.directory = '/usr/bin';
        program_obj.user = 'root';
        program_obj.autostart = 'true';
        program_obj.priority = '1';
        return P.resolve()
            .then(() => SupervisorCtl.remove_program('mongos')) //remove old mongos with old cfg_array
            .then(() => SupervisorCtl.add_program(program_obj));
    }


    _add_new_config_program() {
        let program_obj = {};
        let dbpath = config.MONGO_DEFAULTS.CFG_DB_PATH;
        program_obj.name = 'mongocfg';
        program_obj.command = 'mongod --configsvr ' +
            ' --replSet ' + config.MONGO_DEFAULTS.CFG_RSET_NAME +
            ' --port ' + config.MONGO_DEFAULTS.CFG_PORT +
            ' --dbpath ' + dbpath +
            ' --syslog ' +
            ' --syslogFacility local0';
        program_obj.directory = '/usr/bin';
        program_obj.user = 'root';
        program_obj.autostart = 'true';
        program_obj.priority = '1';
        return fs_utils.create_fresh_path(dbpath)
            .then(() => SupervisorCtl.add_program(program_obj));
    }


    _remove_single_mongo_program() {
        return P.resolve()
            .then(() => SupervisorCtl.remove_program('mongo_wrapper'));
    }


    _refresh_services_list() {
        //TODO:: add real status form mongo per each
        return P.resolve()
            .then(() => SupervisorCtl.get_mongo_services())
            .then(mongo_services => {
                this._mongo_services = mongo_services;
            });
    }


    _publish_rs_name_current_server(params) {
        return server_rpc.client.redirector.publish_to_cluster({
            method_api: 'server_inter_process_api',
            method_name: 'update_mongo_connection_string',
            target: '',
            request_params: params
        });
    }


    _init_replica_set_from_shell(ip) {
        let host = ip + ':' + config.MONGO_DEFAULTS.SHARD_SRV_PORT;
        let mongo_shell_command = `mongo nbcore --port ${config.MONGO_DEFAULTS.SHARD_SRV_PORT} --ssl` +
            ` --sslPEMKeyFile ${config.MONGO_DEFAULTS.CLIENT_CERT_PATH}` +
            ` --sslCAFile ${config.MONGO_DEFAULTS.ROOT_CA_PATH} --sslAllowInvalidHostnames` +
            ` --eval "var host='${host}', user='${process.env.MONGO_SSL_USER}'"` +
            ' /root/node_modules/noobaa-core/src/deploy/NVA_build/mongo_init_rs.js';
        dbg.log0(`running command ${mongo_shell_command}`);
        return promise_utils.exec(mongo_shell_command, {
            ignore_rc: false,
            return_stdout: false
        });
    }

}


module.exports = new MongoCtrl(); // Singleton
