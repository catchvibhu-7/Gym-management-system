const express = require('express');
const { requireStaff, verifyPassword, hashPassword } = require('../auth');
const { db } = require('../db');
const settingsStore = require('../settingsStore');
const storage = require('../storage');

const router = express.Router();
router.use(requireStaff());

const FAVICON_MIME_EXT = {
  'image/png': '.png', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico',
  'image/svg+xml': '.svg', 'image/jpeg': '.jpg',
};
const MAX_FAVICON_BYTES = 300 * 1024;

const EDITABLE_KEYS = [
  'gym_name', 'gym_tagline', 'currency_code', 'currency_symbol',
  'gst_enabled', 'gst_number', 'gst_percentage',
  'payment_provider', 'razorpay_key_id', 'razorpay_key_secret', 'razorpay_webhook_secret',
  'notification_provider', 'notification_api_key', 'notification_from',
  'trial_duration_days', 'fob_fee_cents', 'admission_fee_cents', 'admission_perks_days',
  'nav_order',
];

router.get('/', (req, res) => {
  res.json(settingsStore.getPublic());
});

router.patch('/', requireStaff('owner', 'manager'), (req, res) => {
  const body = req.body || {};
  const update = {};
  for (const key of EDITABLE_KEYS) {
    if (key in body) {
      // A secret left as the masked placeholder means "don't change it".
      if (settingsStore.SECRET_KEYS.has(key) && body[key] === '••••••••') continue;
      update[key] = body[key];
    }
  }
  settingsStore.setMany(update);
  res.json(settingsStore.getPublic());
});

router.post('/favicon', requireStaff('owner', 'manager'), (req, res) => {
  const { dataUrl } = req.body || {};
  const match = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) return res.status(400).json({ error: 'Expected an image file.' });
  const [, mime, base64] = match;
  const ext = FAVICON_MIME_EXT[mime];
  if (!ext) return res.status(400).json({ error: 'Use a PNG, ICO, SVG, or JPEG image.' });
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_FAVICON_BYTES) return res.status(400).json({ error: 'Image is too large (300KB max).' });
  const oldKey = settingsStore.get('favicon_key');
  const key = storage.put(buffer, `favicon${ext}`);
  settingsStore.set('favicon_key', key);
  if (oldKey) storage.remove(oldKey);
  res.json(settingsStore.getPublic());
});

router.delete('/favicon', requireStaff('owner', 'manager'), (req, res) => {
  const oldKey = settingsStore.get('favicon_key');
  if (oldKey) storage.remove(oldKey);
  settingsStore.set('favicon_key', '');
  res.json(settingsStore.getPublic());
});

router.post('/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (!verifyPassword(currentPassword || '', req.staff.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.prepare('UPDATE staff SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.staff.id);
  res.json({ ok: true });
});

module.exports = router;
