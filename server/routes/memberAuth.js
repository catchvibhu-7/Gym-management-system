const express = require('express');
const { db } = require('../db');
const { verifyPassword, hashPassword, createMemberSession, destroyMemberSession, requireMember } = require('../auth');
const { checkRateLimit, recordFailedAttempt, clearRateLimit } = require('../rate-limit');

const router = express.Router();

// Members log in with phone + PIN. New members get a PIN set at onboarding
// (default: last 4 digits of their phone) since there is no SMS/OTP vendor
// wired up yet - see README for why that's a deliberate placeholder. A
// 4-digit PIN is only 10,000 combinations, and the default value is
// derivable from the phone number itself - without a rate limit, anyone
// who knows (or guesses) a member's phone number could script through
// every PIN in seconds, or just try "last 4 digits of the phone" against
// every member who never bothered to change it. Limited both per-IP (slows
// down scripted attempts) and per-phone (still limited even spread across
// many IPs/proxies targeting one specific member).
router.post('/login', (req, res) => {
  const { phone, pin } = req.body || {};
  if (!phone || !pin) return res.status(400).json({ error: 'Phone and PIN required' });
  const normalizedPhone = phone.trim();
  const ipKey = `member-login-ip:${req.ip}`;
  const phoneKey = `member-login-phone:${normalizedPhone}`;
  if (!checkRateLimit(ipKey) || !checkRateLimit(phoneKey)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  const member = db.prepare('SELECT * FROM members WHERE phone = ?').get(normalizedPhone);
  if (!member || !member.pin_hash || !verifyPassword(pin, member.pin_hash)) {
    recordFailedAttempt(ipKey);
    recordFailedAttempt(phoneKey);
    return res.status(401).json({ error: 'Invalid phone or PIN' });
  }
  clearRateLimit(phoneKey);
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
