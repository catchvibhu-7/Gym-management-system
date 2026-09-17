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

function runMigrations(db) {
  ensureColumn(db, 'plans', 'billing_period', "TEXT NOT NULL DEFAULT 'monthly'");
  ensureColumn(db, 'memberships', 'billing_period', "TEXT NOT NULL DEFAULT 'monthly'");
  ensureColumn(db, 'invoices', 'gateway_order_id', 'TEXT');
  ensureColumn(db, 'invoices', 'gateway_payment_id', 'TEXT');
}

module.exports = { runMigrations, ensureColumn, hasColumn };
