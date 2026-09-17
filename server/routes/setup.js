const express = require('express');
const { db } = require('../db');
const { hashPassword, createStaffSession } = require('../auth');

const router = express.Router();

// First-run only: the precreated staff account is role='admin' (system
// access, no member/billing data - see auth.js's STAFF_ROLES), never
// 'owner'. Nobody can actually run the gym until a real owner account
// exists, so the console shows a setup wizard instead of the login screen
// until one is created here. Once an owner exists, create-owner refuses to
// run again - there is no "add another owner" path through this route,
// that's what Team management is for once you're logged in.
function ownerExists() {
  return db.prepare(`SELECT COUNT(*) c FROM staff WHERE role = 'owner' AND active = 1`).get().c > 0;
}

router.get('/status', (req, res) => {
  res.json({ needsSetup: !ownerExists() });
});

router.post('/create-owner', (req, res) => {
  if (ownerExists()) return res.status(403).json({ error: 'Setup has already been completed.' });
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM staff WHERE email = ?').get(normalizedEmail);
  if (existing) return res.status(409).json({ error: 'A staff account with this email already exists.' });

  const info = db.prepare(
    `INSERT INTO staff (name, role, email, password_hash, access) VALUES (?, 'owner', ?, ?, 'full')`
  ).run(name.trim(), normalizedEmail, hashPassword(password));

  createStaffSession(res, req, info.lastInsertRowid);
  res.status(201).json({ id: info.lastInsertRowid, name: name.trim(), role: 'owner', access: 'full' });
});

module.exports = router;
