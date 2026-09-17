const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('./db');

const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const DB_PATH = path.join(DATA_DIR, 'gym.db');
const KEEP_BACKUPS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

fs.mkdirSync(BACKUPS_DIR, { recursive: true });

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function checkpoint() {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { /* nothing to checkpoint yet */ }
}

function pruneOldBackups(keep = KEEP_BACKUPS) {
  const files = fs.readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  files.slice(keep).forEach(({ f }) => fs.unlinkSync(path.join(BACKUPS_DIR, f)));
}

function runBackup(label = 'auto') {
  checkpoint();
  const filename = `gym-${label}-${timestamp()}.db`;
  fs.copyFileSync(DB_PATH, path.join(BACKUPS_DIR, filename));
  pruneOldBackups();
  return filename;
}

function listBackups() {
  return fs.readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, f));
      return { filename: f, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

let scheduleTimer = null;
function startBackupSchedule() {
  if (scheduleTimer) return;
  try { runBackup('boot'); } catch (err) { console.error('Initial backup failed:', err.message); }
  scheduleTimer = setInterval(() => {
    try { runBackup('daily'); } catch (err) { console.error('Scheduled backup failed:', err.message); }
  }, DAY_MS);
  if (scheduleTimer.unref) scheduleTimer.unref();
}

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0');
function isValidSqliteFile(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 16 && buffer.subarray(0, 16).equals(SQLITE_MAGIC);
}

// Overwrites the live database with an uploaded backup. Closes the SQLite
// connection first - on Windows the file is locked while open, so the
// write would otherwise fail outright. There is no safe way to keep
// serving requests after swapping the file out from under every route
// that already holds a reference to the old connection, so the caller is
// expected to exit the process right after this returns.
function restoreFrom(buffer) {
  if (!isValidSqliteFile(buffer)) {
    throw new Error('That file is not a valid SQLite database.');
  }
  runBackup('before-restore');
  checkpoint();
  db.close();
  fs.writeFileSync(DB_PATH, buffer);
  for (const ext of ['-wal', '-shm']) {
    const sidecar = DB_PATH + ext;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }
}

// After a restore there is no safe way to keep serving on the old
// connection, so something has to end the process. Plain `node`/nodemon
// runs just exit (and nodemon or the user restarts them); the Electron
// wrapper overrides this via setRestoreHandler to relaunch the whole app
// instead of just disappearing.
let restoreHandler = () => setTimeout(() => process.exit(0), 200);
function setRestoreHandler(fn) { restoreHandler = fn; }
function triggerRestoreRestart() { restoreHandler(); }

module.exports = {
  runBackup, listBackups, startBackupSchedule, restoreFrom, setRestoreHandler, triggerRestoreRestart,
  BACKUPS_DIR, DB_PATH,
};
