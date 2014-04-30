'use strict';


var fs    = require('fs');
var path  = require('path');
var _     = require('lodash');
var async = require('async');

var pako_utils = require('../lib/utils/common');
var pako  = require('../index');

// Load fixtures to test
// return: { 'filename1': content1, 'filename2': content2, ...}
//
function loadSamples() {
  var result = {};
  var dir = path.join(__dirname, 'fixtures/samples');

  fs.readdirSync(dir).sort().forEach(function (sample) {
    var filepath = path.join(dir, sample),
        extname  = path.extname(filepath),
        basename = path.basename(filepath, extname),
        content  = new Uint8Array(fs.readFileSync(filepath));

    if (basename[0] === '_') { return; } // skip files with name, started with dash

    result[basename] = content;
  });

  return result;
}

// Load fixtures to test
// return: { 'filename1': {
//  content : content1,
//  expected : expected1
// },
// 'filename2': {
//  content : content2,
//  expected : expected2
// } ...
//
function loadSamplesDeflatedRaw() {
  var result = {};
  var dir = path.join(__dirname, 'fixtures/samples_deflated_raw/');

  var filterCompressedFiles = function (file) {
    return !!file.match(/\.compressed$/);
  };
  fs.readdirSync(dir).sort().filter(filterCompressedFiles).forEach(function (sample) {
    var filepath        = path.join(dir, sample),
        extname         = path.extname(filepath),
        basename        = path.basename(filepath, extname),
        expectedpath    = path.join(dir, basename + '.data'),
        content         = new Uint8Array(fs.readFileSync(filepath)),
        expectedContent = new Uint8Array(fs.readFileSync(expectedpath));

    if (basename[0] === '_') { return; } // skip files with name, started with dash

    result[basename] = {
      content : content,
      expected : expectedContent
    };
  });

  return result;
}


// Compare 2 buffers (can be Array, Uint8Array, Buffer).
//
function cmpBuf(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  for (var i=0, l=a.length; i<l; i++) {
    if (a[i] !== b[i]) {
      //console.log('pos: ' +i+ ' - ' + a[i].toString(16) + '/' + b[i].toString(16));
      return false;
    }
  }

  return true;
}


// Helper to test deflate/deflateRaw with different options.
// Use zlib streams, because it's the only way to define options.
//
function testDeflateSingle(zlib_factory, pako_deflate, data, options, callback) {

  var zlib_options = _.clone(options);

  // hack for testing negative windowBits
  if (zlib_options.windowBits < 0) { zlib_options.windowBits = -zlib_options.windowBits; }

  var zlibStream = zlib_factory(zlib_options);
  var buffers = [], nread = 0;


  zlibStream.on('error', function(err) {
    zlibStream.removeAllListeners();
    zlibStream=null;
    callback(err);
  });

  zlibStream.on('data', function(chunk) {
    buffers.push(chunk);
    nread += chunk.length;
  });

  zlibStream.on('end', function() {
    zlibStream.removeAllListeners();
    zlibStream=null;

    var buffer = Buffer.concat(buffers);

    var pako_result = pako_deflate(data, options);

    if (!cmpBuf(buffer, pako_result)) {
      callback(new Error('zlib result != pako result'));
      return;
    }

    callback(null);
  });


  zlibStream.write(new Buffer(data));
  zlibStream.end();
}

function testDeflate(zlib_factory, pako_deflate, samples, options, callback) {
  var queue = [];

  _.forEach(samples, function(data, name) {
    // with untyped arrays
    queue.push(function (done) {
      pako_utils.setTyped(false);

      testDeflateSingle(zlib_factory, pako_deflate, data, options, function (err) {
        if (err) {
          done('Error in "' + name + '" - zlib result != pako result');
          return;
        }
        done();
      });
    });

    // with typed arrays
    queue.push(function (done) {
      pako_utils.setTyped(true);

      testDeflateSingle(zlib_factory, pako_deflate, data, options, function (err) {
        if (err) {
          done('Error in "' + name + '" - zlib result != pako result');
          return;
        }
        done();
      });
    });
  });

  async.series(queue, callback);
}


function testInflate(samples, inflateOptions, deflateOptions, callback) {
  var name, data, deflated, inflated;

  // inflate options have windowBits = 0 to force autodetect window size
  //
  for (name in samples) {
    data = samples[name];

    // always use the same data type to generate sample
    pako_utils.setTyped(true);
    deflated = pako.deflate(data, deflateOptions);

    // with untyped arrays
    pako_utils.setTyped(false);
    inflated = pako.inflate(deflated, inflateOptions);
    pako_utils.setTyped(true);

    if (!cmpBuf(inflated, data)) {
      callback('Error in "' + name + '" - inflate result != original');
      return;
    }

    // with typed arrays
    inflated = pako.inflate(deflated, inflateOptions);

    if (!cmpBuf(inflated, data)) {
      callback('Error in "' + name + '" - inflate result != original');
      return;
    }
  }

  callback();
}

function testInflateExternal(samples, inflateOptions, callback) {
  var name, content, expected, inflated;

  for (name in samples) {
    content = samples[name].content;
    expected  = samples[name].expected;

    inflated = pako.inflate(content, inflateOptions);

    if (!cmpBuf(inflated, expected)) {
      callback(new Error('Error in "' + name + '" - inflate result != original'));
      return;
    }

    // with typed arrays
    inflated = pako.inflateRaw(content, inflateOptions);

    if (!cmpBuf(inflated, expected)) {
      callback('Error in "' + name + '" - inflate result != original');
      return;
    }
  }

  callback();
}


exports.cmpBuf = cmpBuf;
exports.testDeflate = testDeflate;
exports.testInflate = testInflate;
exports.testInflateExternal = testInflateExternal;
exports.loadSamples = loadSamples;
exports.loadSamplesDeflatedRaw = loadSamplesDeflatedRaw;
