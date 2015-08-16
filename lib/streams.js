"use strict";

var Duplex = require('stream').Duplex,
    Transform = require('stream').Transform,
    utillib = require('util'),
    mimelib = require("mimelib"),
    encodinglib = require("encoding"),
    crypto = require("crypto"),
    uue = require('uue');

// here we've swapped out the upstream streams implementations for
// implementations that implement the v.10 streams interface albeit
// without backpressure
module.exports.Base64Stream = require('base64-stream').decode;
module.exports.QPStream = QPDecode;
module.exports.BinaryStream = BinaryDecode;
module.exports.UUEStream = UUEDecode;

require('util').inherits(QPDecode, Duplex);

function QPDecode(charset) {
  if ( !(this instanceof QPDecode) )
    return new QPDecode();

  Duplex.call(this, {
    // The input is converted to strings, so no need to transform input strings to buffers
    decodeStrings : false
  });

  this.checksum = crypto.createHash("md5");
  this.length = 0;
  this.charset = charset || "UTF-8";
  this.current = undefined;
}

QPDecode.prototype._write = function (chunk, encoding, callback) {
  if (!chunk || !chunk.length) {
    return;
  }

  chunk = (chunk || "").toString("utf-8");
  if (chunk.match(/^\r\n/)) {
    chunk = chunk.substr(2);
  }

  if (typeof this.current != "string") {
    this.current = chunk;
  } else {
    this.current += "\r\n" + chunk;
  }

  callback();
};

// WARNING: doens't implement back pressure
QPDecode.prototype._read = function (size) {
  var buffer = mimelib.decodeQuotedPrintable(this.current, false, this.charset);

  if (this.charset.toLowerCase() == "binary") {
    // do nothing
  } else if (this.charset.toLowerCase() != "utf-8") {
    buffer = encodinglib.convert(buffer, "utf-8", this.charset);
  } else {
    buffer = new Buffer(buffer, "utf-8");
  }

  this.length += buffer.length;
  this.checksum.update(buffer);

  this.push(buffer);
};

require('util').inherits(BinaryDecode, Transform);

function BinaryDecode() {
  if ( !(this instanceof BinaryDecode) )
    return new BinaryDecode();

  Transform.call(this);

  this.checksum = crypto.createHash("md5");
  this.length = 0;
}

BinaryDecode.prototype._transform = function (chunk, encoding, cb) {
  if (chunk && chunk.length) {
    this.length += chunk.length;
    this.checksum.update(chunk);
    this.push(chunk);
  }

  cb();
};

require('util').inherits(UUEDecode, Duplex);

// this is not a stream, it buffers data and decodes after end
function UUEDecode(charset) {
  if ( !(this instanceof UUEDecode) )
    return new UUEDecode();

  Duplex.call(this);

  this.checksum = crypto.createHash("md5");
  this.length = 0;
  this.buf = [];
  this.buflen = 0;
  this.charset = charset || "UTF-8";
  this.current = undefined;
}

UUEDecode.prototype._write = function (chunk, encoding, callback) {
  if (!chunk || !chunk.length) {
    return;
  }

  this.buf.push(chunk);
  this.buflen += chunk.length;

  callback();
};

// WARNING: doens't implement back pressure
UUEDecode.prototype._read = function (size) {
  var buffer = this.__flush();

  this.push(buffer);
};

UUEDecode.prototype.__flush = function() {
  var buffer = this.decode(Buffer.concat(this.buf, this.buflen));

  this.length += buffer.length;
  this.checksum.update(buffer);

  return buffer;
};

UUEDecode.prototype.decode = function(buffer) {
  var filename;

  filename = buffer.slice(0, Math.min(buffer.length, 1024)).toString().split(/\s/)[2] || '';
  if (!filename) {
    return new Buffer(0);
  }

  buffer = uue.decodeFile(buffer.toString('ascii').replace(/\r\n/g, '\n'), filename);

  if (this.charset.toLowerCase() == "binary") {
    // do nothing
  } else if (this.charset.toLowerCase() != "utf-8") {
    buffer = encodinglib.convert(buffer, "utf-8", this.charset);
  }

  return buffer;
};
