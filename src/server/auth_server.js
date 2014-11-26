// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var moment = require('moment');
var db = require('./db');
var rest_api = require('../util/rest_api');
var api = require('../api');
var express_jwt = require('express-jwt');
var jwt = require('jsonwebtoken');


var auth_server = new api.auth_api.Server({
    // CRUD
    create_auth: create_auth,
    update_auth: update_auth,
    read_auth: read_auth,
});

// authorize is exported to be used as an express middleware
// it reads and prepares the authorized info on the request.
auth_server.authorize = authorize;

module.exports = auth_server;



//////////
// CRUD //
//////////

function create_auth(req) {
    var password = req.rest_params.password;
    var account;
    // find the account by email, and verify password
    return Q.fcall(
        function() {
            return db.Account.findOne({
                email: req.rest_params.email,
                deleted: null,
            }).exec();
        }
    ).then(
        function(account_arg) {
            account = account_arg;
            if (!account) {
                // consider no account as non matching password
                // to avoid brute force attacks of requests on this api.
                return false;
            } else {
                return Q.npost(account, 'verify_password', [password]);
            }
        }
    ).then(
        function(matching) {
            if (!matching) {
                throw req.rest_error('incorrect email and password');
            }
            return auth_by_account(req, account.id);
        }
    );
}


function update_auth(req) {
    return req.load_account('force_miss').then(
        function() {
            return auth_by_account(req, req.account.id);
        }
    );
}


function auth_by_account(req, account_id) {
    var system_name = req.rest_params.system;
    var expires = req.rest_params.expires;
    var system;
    var role;
    return Q.fcall(
        function() {
            if (!system_name) {
                return;
            }
            // find system
            return db.System.findOne({
                name: system_name,
                deleted: null,
            }).exec().then(
                function(system_arg) {
                    system = system_arg;
                    if (!system || system.deleted) {
                        throw req.rest_error('system not found');
                    }
                    // find role
                    return db.Role.findOne({
                        account: account_id,
                        system: system.id,
                    }).exec();
                }
            ).then(
                function(role_arg) {
                    role = role_arg;
                    if (!role) {
                        throw req.rest_error('role not found');
                    }
                }
            );
        }
    ).then(
        function() {
            // use jwt (json web token) to create a signed token
            var jwt_payload = {
                account_id: account_id
            };
            if (system_name) {
                jwt_payload.system_id = system.id;
                jwt_payload.role = role.role;
            }
            var jwt_options = {};
            if (expires) {
                jwt_options.expiresInMinutes = expires / 60;
            }
            var token = jwt.sign(jwt_payload, process.env.JWT_SECRET, jwt_options);
            return {
                token: token
            };
        }
    );
}


function read_auth(req) {
    if (!req.auth) {
        return {};
    }
    var reply = {};
    if (req.auth.role) {
        reply.role = req.auth.role;
    }

    return Q.fcall(
        function() {
            if (req.auth.account_id) {
                return db.AccountCache.get(req.auth.account_id, 'force_miss').then(
                    function(account) {
                        if (account) {
                            reply.account = _.pick(account, 'name', 'email');
                        }
                    }
                );
            }
        }
    ).then(
        function() {
            if (req.auth && req.auth.system_id) {
                return db.SystemCache.get(req.auth.system_id, 'force_miss').then(
                    function(system) {
                        if (system) {
                            reply.system = _.pick(system, 'name');
                        }
                    }
                );
            }
        }
    ).thenResolve(reply);
}



//////////////////////////
// AUTHORIZE MIDDLEWARE //
//////////////////////////

function authorize() {
    // use jwt (json web token) to verify and decode the signed token
    // the token is expected to be set in req.headers.authorization = 'Bearer ' + token
    // which is a standard token authorization used by oauth2.
    var ej = express_jwt({
        secret: process.env.JWT_SECRET,
        userProperty: 'auth',
        credentialsRequired: false,
    });
    // return an express middleware
    return function(req, res, next) {
        ej(req, res, function(err) {
            if (err) {
                console.log('AUTH ERROR', err);
                if (err.name === 'UnauthorizedError') {
                    // if the verification of the token failed it might be because of expiration
                    // in any case return http code 401 (Unauthorized)
                    // hoping the client will do authenticate() again.
                    res.status(401).send('unauthorized token');
                } else {
                    next(err);
                }
            } else {
                prepare_auth_request(req);
                next();
            }
        });
    };
}

// hang calls on the request to be able to use in other api's.
function prepare_auth_request(req) {

    // verify that the request auth has a valid account and set req.account.
    req.load_account = function(force_miss) {
        return Q.fcall(
            function() {
                if (req.account) {
                    return; // already loaded
                }
                if (!req.auth || !req.auth.account_id) {
                    throw req.rest_error('unauthorized', 401);
                }
                return db.AccountCache.get(req.auth.account_id, force_miss).then(
                    function(account) {
                        if (!account) {
                            throw new Error('account missing');
                        }
                        req.account = account;
                    }
                );
            }
        );
    };

    // verify that the request auth has a valid system and set req.system and req.role.
    // also calls load_account.
    req.load_system = function(valid_roles, force_miss) {
        return req.load_account().then(
            function() {
                if (req.system) {
                    return; // already loaded
                }
                var err;
                if (!req.auth || !req.auth.system_id) {
                    throw req.rest_error('unauthorized system', 401);
                }
                if ((!valid_roles && !req.auth.role) ||
                    (valid_roles && !_.contains(valid_roles, req.auth.role))) {
                    throw req.rest_error('forbidden role', 403);
                }
                return db.SystemCache.get(req.auth.system_id, force_miss).then(
                    function(system) {
                        if (!system) {
                            throw new Error('system missing');
                        }
                        req.system = system;
                        req.role = req.auth.role;
                    }
                );
            }
        );
    };
}
