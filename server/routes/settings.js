const express = require('express');
const { requireStaff, verifyPassword, hashPassword } = require('../auth');
const { db } = require('../db');
const settingsStore = require('../settingsStore');

const router = express.Router();
router.use(requireStaff());

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
