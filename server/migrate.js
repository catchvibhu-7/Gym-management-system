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

// workout_plans.member_id started NOT NULL (every row was a per-member
// assignment) - a template/library plan has no member yet, so this widens
// it to nullable the same recreate-table way migrateStaffRoleCheck widens
// a CHECK constraint. Detected via the stored CREATE TABLE text so this
// stays a no-op once applied.
function migrateWorkoutPlansMemberIdNullable(db) {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'workout_plans'`).get();
  if (!row || !row.sql.includes('member_id INTEGER NOT NULL')) return;
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE workout_plans_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
        created_by TEXT NOT NULL DEFAULT 'member' CHECK (created_by IN ('member','staff')),
        created_by_staff_id INTEGER REFERENCES staff(id),
        title TEXT NOT NULL,
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec('INSERT INTO workout_plans_new SELECT * FROM workout_plans');
    db.exec('DROP TABLE workout_plans');
    db.exec('ALTER TABLE workout_plans_new RENAME TO workout_plans');
    db.exec(`
      INSERT INTO sqlite_sequence (name, seq)
      SELECT 'workout_plans', COALESCE((SELECT MAX(id) FROM workout_plans), 0)
      WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'workout_plans')
    `);
    db.exec(`UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id),0) FROM workout_plans) WHERE name = 'workout_plans'`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

// A member's email had no uniqueness constraint at all - phone already
// does (schema.sql: UNIQUE NOT NULL), but two different members could
// share the same email. A plain index creation would fail outright if any
// duplicates already exist in a real database, crashing the app on every
// boot until someone manually fixed the data - so this checks first and
// only adds the constraint once the data is actually clean, logging a
// clear warning (not a crash) otherwise. Self-heals: it tries again, and
// succeeds, the very next boot after the duplicates are resolved.
function migrateMembersEmailUnique(db) {
  const exists = db.prepare(
    `SELECT COUNT(*) c FROM sqlite_master WHERE type = 'index' AND name = 'idx_members_email_unique'`
  ).get().c > 0;
  if (exists) return;
  const dupes = db.prepare(
    `SELECT email, COUNT(*) c FROM members WHERE email IS NOT NULL AND email != '' GROUP BY email HAVING c > 1`
  ).all();
  if (dupes.length) {
    console.warn(
      `Skipping unique-email constraint on members: ${dupes.length} email address(es) are already shared by more than one member (e.g. "${dupes[0].email}"). Fix those duplicates, then restart to have this take effect.`
    );
    return;
  }
  db.exec('CREATE UNIQUE INDEX idx_members_email_unique ON members(email)');
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
  ensureColumn(db, 'plans', 'gst_applicable', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'day_pass_types', 'gst_applicable', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'workout_plan_exercises', 'day_of_week', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'workout_plan_exercises', 'section', "TEXT NOT NULL DEFAULT 'workout' CHECK (section IN ('warmup','workout','stretch'))");
  ensureColumn(db, 'workout_plan_exercises', 'week_number', 'INTEGER NOT NULL DEFAULT 1');
  // Must run before the ensureColumn calls below - it recreates the table
  // from its OLD (pre-library-feature) column set, so any new columns
  // added first would be dropped by the recreation's INSERT...SELECT *.
  migrateWorkoutPlansMemberIdNullable(db);
  ensureColumn(db, 'workout_plans', 'is_template', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'workout_plans', 'plan_type', "TEXT NOT NULL DEFAULT 'weekly' CHECK (plan_type IN ('weekly','monthly'))");
  ensureColumn(db, 'workout_plans', 'visibility', "TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','trainer','universal'))");
  ensureColumn(db, 'workout_plans', 'price_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'workout_plans', 'source_template_id', 'INTEGER REFERENCES workout_plans(id)');
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
  migrateMembersEmailUnique(db);
}

module.exports = { runMigrations, ensureColumn, hasColumn };
