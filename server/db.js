const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// Packaged into an Electron .asar archive, __dirname resolves INSIDE that
// read-only archive (".../resources/app.asar/server") - fs.mkdirSync on
// anything under it fails outright with ENOTDIR, since app.asar is a
// single file, not a real directory, on disk. electron/main.js sets
// GYM_DATA_DIR to a real writable per-OS location (Electron's userData
// path) before requiring this module; a plain `npm start`/`npm run
// dev:server` (no Electron, no asar) never sets it, so this falls back to
// the original relative-to-source path unchanged.
const DATA_DIR = process.env.GYM_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'gym.db');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Node's built-in SQLite (stable enough for this app, and avoids the
// better-sqlite3 native-compile step that needs Python + a C++ toolchain -
// a real installation blocker on a bare Windows machine).
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const { runMigrations } = require('./migrate');
runMigrations(db);

module.exports = { db, DATA_DIR, UPLOADS_DIR };
