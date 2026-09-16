// Local "bucket" object storage. Same put/get/delete shape a real S3 client
// would expose, so swapping in MinIO/S3 later only touches this file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UPLOADS_DIR } = require('./db');

function keyFor(originalName) {
  const ext = path.extname(originalName || '').slice(0, 10);
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

function put(buffer, originalName) {
  const key = keyFor(originalName);
  fs.writeFileSync(path.join(UPLOADS_DIR, key), buffer);
  return key;
}

function remove(key) {
  if (!key) return;
  const p = path.join(UPLOADS_DIR, key);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function urlFor(key) {
  return key ? `/uploads/${key}` : null;
}

function absolutePath(key) {
  return path.join(UPLOADS_DIR, key);
}

module.exports = { put, remove, urlFor, absolutePath, UPLOADS_DIR };
