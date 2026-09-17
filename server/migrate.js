// Lightweight in-place migrations. schema.sql's CREATE TABLE IF NOT EXISTS
// only helps on a brand-new database - anyone with an existing local
// data/gym.db needs new columns added without losing their data, so each
// migration here is a guarded ALTER TABLE (skipped if the column already
// exists) run every boot.

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function ensureColumn(db, table, column, definition) {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// staff.role's CHECK constraint can't be widened with ALTER TABLE in
// SQLite, so adding a new role means recreating the table. Detected by
// checking the stored CREATE TABLE text rather than a version counter, so
// this stays a no-op once already applied.
function migrateStaffRoleCheck(db) {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'staff'`).get();
  if (!row || row.sql.includes("'admin'")) return;
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE staff_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner','manager','coach','desk','kiosk','admin')),
        email TEXT UNIQUE,
        phone TEXT,
        password_hash TEXT NOT NULL,
        access TEXT NOT NULL DEFAULT 'limited' CHECK (access IN ('full','limited')),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec('INSERT INTO staff_new SELECT * FROM staff');
    db.exec('DROP TABLE staff');
    db.exec('ALTER TABLE staff_new RENAME TO staff');
    db.exec(`
      INSERT INTO sqlite_sequence (name, seq)
      SELECT 'staff', COALESCE((SELECT MAX(id) FROM staff), 0)
      WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'staff')
    `);
    db.exec(`UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id),0) FROM staff) WHERE name = 'staff'`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function runMigrations(db) {
  ensureColumn(db, 'plans', 'billing_period', "TEXT NOT NULL DEFAULT 'monthly'");
  ensureColumn(db, 'memberships', 'billing_period', "TEXT NOT NULL DEFAULT 'monthly'");
  ensureColumn(db, 'invoices', 'gateway_order_id', 'TEXT');
  ensureColumn(db, 'invoices', 'gateway_payment_id', 'TEXT');

  migrateStaffRoleCheck(db);

  ensureColumn(db, 'members', 'trial_ends_at', 'TEXT');
  ensureColumn(db, 'members', 'admission_fee_paid', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'members', 'perks_until', 'TEXT');
  ensureColumn(db, 'members', 'qr_suspended', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'members', 'fob_suspended', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'members', 'fob_fee_paid', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'members', 'pre_freeze_access_method', 'TEXT');
  ensureColumn(db, 'day_pass_types', 'active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'staff', 'staff_type', 'TEXT');
  ensureColumn(db, 'staff', 'pt_rate_cents', 'INTEGER');
  ensureColumn(db, 'day_passes', 'payment_method', 'TEXT');
  ensureColumn(db, 'day_passes', 'gateway_order_id', 'TEXT');
  ensureColumn(db, 'day_passes', 'gateway_payment_id', 'TEXT');

  const hadPrimaryChannel = hasColumn(db, 'automations', 'primary_channel');
  ensureColumn(db, 'automations', 'primary_channel', "TEXT NOT NULL DEFAULT 'SMS'");
  ensureColumn(db, 'automations', 'secondary_channel', 'TEXT');
  if (!hadPrimaryChannel) {
    // One-time backfill from the old single `channel` column, right when
    // primary_channel is first added - never repeated, so a later manual
    // change to primary_channel can't get silently reverted on next boot.
    db.exec(`UPDATE automations SET primary_channel = channel WHERE channel IS NOT NULL`);
  }
}

module.exports = { runMigrations, ensureColumn, hasColumn };
