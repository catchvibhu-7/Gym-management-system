const express = require('express');
const { db } = require('../db');
const { requireStaff, hashPassword } = require('../auth');
const { initialsOf } = require('../utils');

const router = express.Router();
router.use(requireStaff());

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', coach: 'Coach', desk: 'Desk staff', kiosk: 'Kiosk (door only)', admin: 'Admin (system only)' };
const VALID_ROLES = ['owner', 'manager', 'coach', 'desk', 'kiosk', 'admin'];

router.get('/', (req, res) => {
  const staff = db.prepare('SELECT * FROM staff WHERE active = 1 ORDER BY role, name').all();
  res.json(staff.map((s) => {
    const classesThisWeek = db.prepare(
      `SELECT COUNT(*) c FROM class_sessions cs JOIN classes cl ON cl.id = cs.class_id
       WHERE cl.coach_staff_id = ? AND cs.session_date BETWEEN date('now','weekday 1','-7 days') AND date('now','weekday 1','-1 day')`
    ).get(s.id).c;
    return {
      id: s.id, initials: initialsOf(s.name), name: s.name, role: ROLE_LABEL[s.role],
      access: s.access === 'full' ? 'Full console' : 'Limited',
      classes: classesThisWeek ? `${classesThisWeek} this week` : '—',
      hours: '—',
      chipStyle: 'display:inline-block;font-size:11px;font-weight:700;background:#e6f2ed;color:#0e5f4a;padding:4px 9px;border-radius:999px',
      status: 'Active',
    };
  }));
});

router.get('/on-floor', (req, res) => {
  const rows = db.prepare(
    `SELECT m.name FROM checkins c JOIN members m ON m.id = c.member_id
     WHERE c.checked_out_at IS NULL AND c.checked_in_at >= datetime('now','-6 hours')`
  ).all();
  res.json(rows.map((r) => ({ initials: initialsOf(r.name), name: r.name, until: 'now' })));
});

// ---- Staff management (owner/manager only) ----

router.get('/admin', requireStaff('owner', 'manager'), (req, res) => {
  const rows = db.prepare('SELECT id, name, email, phone, role, access, active, staff_type, pt_rate_cents FROM staff ORDER BY active DESC, role, name').all();
  res.json(rows.map((s) => ({
    ...s, initials: initialsOf(s.name), roleLabel: ROLE_LABEL[s.role],
    staffType: s.staff_type, ptRateCents: s.pt_rate_cents,
  })));
});

router.post('/', requireStaff('owner', 'manager'), (req, res) => {
  const { name, email, phone, role, access = 'limited', password, staffType, ptRateCents } = req.body || {};
  if (!name || !email || !role || !password) {
    return res.status(400).json({ error: 'Name, email, role and password are required' });
  }
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const existing = db.prepare('SELECT id FROM staff WHERE email = ?').get(email.trim().toLowerCase());
  if (existing) return res.status(409).json({ error: 'A staff account with this email already exists' });

  const info = db.prepare(
    `INSERT INTO staff (name, role, email, phone, password_hash, access, staff_type, pt_rate_cents) VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    name, role, email.trim().toLowerCase(), phone || null, hashPassword(password), access === 'full' ? 'full' : 'limited',
    staffType && staffType.trim() ? staffType.trim() : null, ptRateCents != null && ptRateCents !== '' ? Number(ptRateCents) : null
  );
  res.status(201).json({ id: info.lastInsertRowid, name, role });
});

router.patch('/:id', requireStaff('owner', 'manager'), (req, res) => {
  const staffRow = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!staffRow) return res.status(404).json({ error: 'Not found' });
  const { name, email, phone, role, access, staffType, ptRateCents } = req.body || {};
  if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const nextEmail = email ? email.trim().toLowerCase() : staffRow.email;
  const nextStaffType = staffType !== undefined ? (staffType && staffType.trim() ? staffType.trim() : null) : staffRow.staff_type;
  const nextPtRate = ptRateCents !== undefined ? (ptRateCents !== '' && ptRateCents !== null ? Number(ptRateCents) : null) : staffRow.pt_rate_cents;
  db.prepare(
    `UPDATE staff SET name = ?, email = ?, phone = ?, role = ?, access = ?, staff_type = ?, pt_rate_cents = ? WHERE id = ?`
  ).run(
    name ?? staffRow.name, nextEmail,
    phone ?? staffRow.phone, role ?? staffRow.role, access ?? staffRow.access,
    nextStaffType, nextPtRate, staffRow.id
  );
  res.json({ ok: true });
});

router.post('/:id/deactivate', requireStaff('owner', 'manager'), (req, res) => {
  if (Number(req.params.id) === req.staff.id) {
    return res.status(400).json({ error: "You can't deactivate your own account" });
  }
  db.prepare('UPDATE staff SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/reactivate', requireStaff('owner', 'manager'), (req, res) => {
  db.prepare('UPDATE staff SET active = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/reset-password', requireStaff('owner', 'manager'), (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const staffRow = db.prepare('SELECT id FROM staff WHERE id = ?').get(req.params.id);
  if (!staffRow) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE staff SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), staffRow.id);
  res.json({ ok: true });
});

module.exports = router;
