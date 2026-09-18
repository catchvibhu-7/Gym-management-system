const express = require('express');
const { db } = require('../db');
const { verifyPassword, createStaffSession, destroyStaffSession, requireStaff, ALL_STAFF_ROLES } = require('../auth');
const { checkRateLimit, recordFailedAttempt, clearRateLimit } = require('../rate-limit');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const normalizedEmail = email.trim().toLowerCase();
  const ipKey = `staff-login-ip:${req.ip}`;
  const emailKey = `staff-login-email:${normalizedEmail}`;
  if (!checkRateLimit(ipKey) || !checkRateLimit(emailKey)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  const staff = db.prepare('SELECT * FROM staff WHERE email = ? AND active = 1').get(normalizedEmail);
  if (!staff || !verifyPassword(password, staff.password_hash)) {
    recordFailedAttempt(ipKey);
    recordFailedAttempt(emailKey);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  clearRateLimit(emailKey);
  createStaffSession(res, req, staff.id);
  res.json({ id: staff.id, name: staff.name, role: staff.role, access: staff.access });
});

router.post('/logout', (req, res) => {
  destroyStaffSession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireStaff(...ALL_STAFF_ROLES), (req, res) => {
  res.json({ id: req.staff.id, name: req.staff.name, role: req.staff.role, access: req.staff.access });
});

module.exports = router;
