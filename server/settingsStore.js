const { db } = require('./db');

// Every configurable knob in the app lives here as a plain key/value row -
// adding a new setting never needs a schema migration, which is what
// "fully customisable" means in practice for a single-table config store.
const DEFAULTS = {
  gym_name: 'Forge Room',
  gym_tagline: 'Strength Club',
  currency_code: 'USD',
  currency_symbol: '$',
  gst_enabled: '0',
  gst_number: '',
  gst_percentage: '0',
  payment_provider: 'none',
  razorpay_key_id: '',
  razorpay_key_secret: '',
  razorpay_webhook_secret: '',
  notification_provider: 'none',
  notification_api_key: '',
  notification_from: '',
};

// Never echoed back to the client once saved - PATCH accepts a new value,
// GET returns a masked placeholder so the UI can show "a key is set"
// without ever re-displaying the secret.
const SECRET_KEYS = new Set(['razorpay_key_secret', 'razorpay_webhook_secret', 'notification_api_key']);

function get(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : (DEFAULTS[key] ?? null);
}

function getAll() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = { ...DEFAULTS };
  rows.forEach((r) => { map[r.key] = r.value; });
  return map;
}

function getPublic() {
  const all = getAll();
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    out[k] = SECRET_KEYS.has(k) ? (v ? '••••••••' : '') : v;
  }
  return out;
}

function set(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

function setMany(obj) {
  for (const [k, v] of Object.entries(obj)) set(k, v);
}

function currencySymbol() {
  return get('currency_symbol') || '$';
}

// Adds GST on top of a base amount if enabled - used wherever a charge is
// created (membership signup, day passes) so the invoice/day-pass amount
// already reflects tax.
function applyGst(baseCents) {
  const enabled = get('gst_enabled') === '1';
  const pct = enabled ? parseFloat(get('gst_percentage')) || 0 : 0;
  const gstCents = Math.round(baseCents * (pct / 100));
  return { baseCents, gstEnabled: enabled, gstPercentage: pct, gstCents, totalCents: baseCents + gstCents };
}

module.exports = { get, getAll, getPublic, set, setMany, currencySymbol, applyGst, DEFAULTS, SECRET_KEYS };
