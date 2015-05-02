/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 *
 * ROLE SCHEMA
 *
 * A role allows an account to act on a system.
 *
 */
var role_schema = new Schema({

    account: {
        ref: 'Account',
        type: types.ObjectId,
        required: true,
    },

    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    role: {
        enum: ['admin', 'user', 'viewer'],
        type: String,
        required: true,
    },

}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});

role_schema.index({
    account: 1,
    system: 1,
}, {
    unique: true
});

module.exports = mongoose.model('Role', role_schema);
