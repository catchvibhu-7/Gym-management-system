const express = require('express');
const { db } = require('../db');
const { verifyPassword, hashPassword, createMemberSession, destroyMemberSession, requireMember } = require('../auth');

const router = express.Router();

// Members log in with phone + PIN. New members get a PIN set at onboarding
// (default: last 4 digits of their phone) since there is no SMS/OTP vendor
// wired up yet - see README for why that's a deliberate placeholder.
router.post('/login', (req, res) => {
  const { phone, pin } = req.body || {};
  if (!phone || !pin) return res.status(400).json({ error: 'Phone and PIN required' });
  const member = db.prepare('SELECT * FROM members WHERE phone = ?').get(phone.trim());
  if (!member || !member.pin_hash || !verifyPassword(pin, member.pin_hash)) {
    return res.status(401).json({ error: 'Invalid phone or PIN' });
  }
  createMemberSession(res, req, member.id);
  res.json({ id: member.id, name: member.name });
});

router.post('/set-pin', requireMember, (req, res) => {
  const { newPin } = req.body || {};
  if (!newPin || newPin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });
  db.prepare('UPDATE members SET pin_hash = ? WHERE id = ?').run(hashPassword(newPin), req.member.id);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  destroyMemberSession(req, res);
  res.json({ ok: true });
});

module.exports = router;
