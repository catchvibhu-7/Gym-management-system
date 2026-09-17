const express = require('express');
const { db } = require('../db');
const { verifyPassword, createStaffSession, destroyStaffSession, requireStaff, ALL_STAFF_ROLES } = require('../auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const staff = db.prepare('SELECT * FROM staff WHERE email = ? AND active = 1').get(email.trim().toLowerCase());
  if (!staff || !verifyPassword(password, staff.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
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
