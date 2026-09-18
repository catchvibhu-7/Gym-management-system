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
  trial_duration_days: '3',
  fob_fee_cents: '10000',
  admission_fee_cents: '0',
  admission_perks_days: '30',
  nav_order: '',
  favicon_key: '',
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
  // Derived, not stored directly - favicon_key is a storage.js key, this is
  // the actual URL the browser tab icon can point at.
  out.favicon_url = all.favicon_key ? `/uploads/${all.favicon_key}` : null;
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
//
// gstApplicable (default true) is a per-plan/per-pass-type choice, not the
// global on/off switch above: true means the stored price EXCLUDES GST, so
// it gets added on top as usual. false means the stored price is already
// GST-inclusive (e.g. a round advertised number) - GST still needs to be
// broken out for the itemised bill, but backed OUT of that price rather
// than added on top, so the customer is never charged it twice.
function applyGst(baseCents, gstApplicable = true) {
  const enabled = get('gst_enabled') === '1';
  const pct = enabled ? parseFloat(get('gst_percentage')) || 0 : 0;
  if (!enabled || pct <= 0) {
    return { baseCents, gstEnabled: enabled, gstPercentage: pct, gstCents: 0, totalCents: baseCents, gstApplicable: true };
  }
  if (gstApplicable) {
    const gstCents = Math.round(baseCents * (pct / 100));
    return { baseCents, gstEnabled: enabled, gstPercentage: pct, gstCents, totalCents: baseCents + gstCents, gstApplicable: true };
  }
  const exclusiveCents = Math.round(baseCents / (1 + pct / 100));
  const gstCents = baseCents - exclusiveCents;
  return { baseCents: exclusiveCents, gstEnabled: enabled, gstPercentage: pct, gstCents, totalCents: baseCents, gstApplicable: false };
}

module.exports = { get, getAll, getPublic, set, setMany, currencySymbol, applyGst, DEFAULTS, SECRET_KEYS };
