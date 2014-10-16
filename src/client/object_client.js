// this module is written for both nodejs, or for client with browserify.
'use strict';

var util = require('util');
var stream = require('stream');
var _ = require('lodash');
var Q = require('q');
var object_api = require('../api/object_api');

var READ_SIZE_MARK = 128 * 1024;
var WRITE_SIZE_MARK = 128 * 1024;


// exporting the ObjectClient module as a class

module.exports = {
    ObjectClient: ObjectClient
};



// ctor of the object client.
// the client provides api access to remote object storage.
// the client API functions have the signature function(params), and return a promise.
//
// client_params (Object): see restful_api.init_client()
//
function ObjectClient(client_params) {
    object_api.Client.call(this, client_params);
}

util.inherits(ObjectClient, object_api.Client);


// in addition to the api functions, the client implements more advanced functions
// for read/write of objects according to the object mapping.


// read_object_data (API)
//
// params (Object):
//   - bucket (String)
//   - key (String)
//   - offset (Number) - offset to start reading from
//   - size (Number) - number of bytes to read
//
// return (Promise for Object):
//   - buffer (Buffer) - data, can be shorter than requested
//
ObjectClient.prototype.read_object_data = function(params) {
    var self = this;
    return self.map_object(params).then(function(res) {
        params.maps = res.data;
        return self.read_maps(params);
    });
};

// write_object_data (API)
//
// params (Object):
//   - bucket (String)
//   - key (String)
//   - offset (Number) - offset to start reading from
//   - size (Number) - number of bytes to read
//   - buffer (Buffer) - data to write
//
// return (Promise)
//
ObjectClient.prototype.write_object_data = function(params) {
    var self = this;
    return self.map_object(_.omit(params, 'buffer')).then(function(res) {
        params.maps = res.data;
        return self.write_maps(params);
    });
};



// read_maps (API)
//
// params (Object):
//   - maps (Object) - mapping info to use for reading
//   - offset (Number) - offset to start reading from
//   - size (Number) - number of bytes to read
//
// return (promise)
//
ObjectClient.prototype.read_maps = function(params) {
    var maps = params.maps;
    var buffer = new Buffer(params.size);
    buffer.fill(0);
    _.each(maps, function(m) {

    });
    // TODO
    return Q.when(buffer);
};

// write_maps (API)
//
// params (Object):
//   - buffer (Buffer) - data to write
//   - maps (Object) - mapping info to use for writing
//   - offset (Number) - offset to start reading from
//   - size (Number) - number of bytes to read
//
// return (promise)
//
ObjectClient.prototype.write_maps = function(params) {
    var maps = params.maps;
    // TODO
    return Q.when();
};



// open_read_stream (API)
//
// params (Object):
//   - bucket (String)
//   - key (String)
//   - offset (Number) - offset to start reading from
//   - size (Number) - number of bytes to read
//
// return Reader (inherits from stream.Readable).
//
ObjectClient.prototype.open_read_stream = function(params) {
    return new Reader(this, params);
};

// Reader is a Readable stream for the specified object and range.

function Reader(client, params) {
    stream.Readable.call(this, {
        // highWaterMark Number - The maximum number of bytes to store
        // in the internal buffer before ceasing to read
        // from the underlying resource. Default=16kb
        highWaterMark: READ_SIZE_MARK,
        // encoding String - If specified, then buffers will be decoded to strings
        // using the specified encoding. Default=null
        encoding: null,
        // objectMode Boolean - Whether this stream should behave as a stream of objects.
        // Meaning that stream.read(n) returns a single value
        // instead of a Buffer of size n. Default=false
        objectMode: false,
    });
    this._reader_client = client;
    var p = _.clone(params);
    p.offset = fix_offset_param(p.offset, 0);
    p.size = fix_offset_param(p.size, Infinity);
    this._reader_params = p;
}

util.inherits(Reader, stream.Readable);

// implement the stream's Readable._read() function.
Reader.prototype._read = function(size) {
    var self = this;
    var client = this._reader_client;
    var params = this._reader_params;
    // make copy of params, trim if size exceeds the map range
    var p = _.clone(params);
    p.size = Math.min(Number(size) || READ_SIZE_MARK, params.size);
    // finish the read if reached the end of the reader range
    if (p.size <= 0) {
        self.push(null);
        return;
    }
    client.read_object_data(p).done(function(buffer) {
        params.offset += p.size;
        params.size -= p.size;
        self.push(buffer);
    }, function(err) {
        self.emit('error', err || 'unknown error');
    });
};



// open_write_stream (API)
//
// params (Object):
//   - bucket (String)
//   - key (String)
//   - offset (Number) - offset to start reading from
//   - size (Number) - number of bytes to read
//
// return Writer (inherits from stream.Writable).
//
ObjectClient.prototype.open_write_stream = function(params) {
    return new Writer(this, params);
};


// Writer is a Writable stream for the specified object and range.

function Writer(client, params) {
    stream.Writable.call(this, {
        // highWaterMark Number - Buffer level when write() starts returning false. Default=16kb
        highWaterMark: WRITE_SIZE_MARK,
        // decodeStrings Boolean - Whether or not to decode strings into Buffers
        // before passing them to _write(). Default=true
        decodeStrings: true,
        // objectMode Boolean - Whether or not the write(anyObj) is a valid operation.
        // If set you can write arbitrary data instead of only Buffer / String data. Default=false
        objectMode: false,
    });
    this._writer_client = client;
    var p = _.clone(params);
    p.offset = fix_offset_param(p.offset, 0);
    p.size = fix_offset_param(p.size, Infinity);
    this._writer_params = p;
}

util.inherits(Writer, stream.Writable);

// implement the stream's Readable._read() function.
Writer.prototype._write = function(chunk, encoding, callback) {
    var client = this._writer_client;
    var params = this._writer_params;
    // make copy of params, trim if buffer exceeds the map range
    var p = _.clone(params);
    p.size = Math.min(chunk.length, params.size);
    p.buffer = slice_buffer(chunk, 0, p.size);
    client.write_object_data(p).done(function() {
        params.offset += p.size;
        params.size -= p.size;
        callback();
    }, function(err) {
        callback(err || 'unknown error');
    });
};


// return a fixed positive
function fix_offset_param(offset, default_value) {
    // if undefined assume the default value
    if (typeof(offset) === 'undefined') {
        return default_value;
    }
    // cast to number (numbers->numbers, Infinity->Infinity, null->0, objects->NaN)
    var x = Number(offset);
    // return positive number, negatives are truncated to 0.
    return x <= 0 ? 0 : x;
}

function slice_buffer(buffer, offset, size) {
    if (offset === 0 && buffer.length === size) {
        return;
    }
    if (typeof(buffer.slice) === 'function') {
        return buffer.slice(offset, offset + size);
    }
    throw new Error('Cannot slice buffer');
}
