const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');
const { initialsOf } = require('../utils');

const router = express.Router();
router.use(requireStaff());

// Self-service: any logged-in staff member clocks themselves in/out. This
// is a staff member's own shift attendance - deliberately a separate
// concept and a separate page from the member-facing Attendance page
// (floor traffic, check-in methods, lapsed members).
router.get('/status', (req, res) => {
  const open = db.prepare(
    `SELECT * FROM staff_attendance WHERE staff_id = ? AND clocked_out_at IS NULL ORDER BY id DESC LIMIT 1`
  ).get(req.staff.id);
  res.json({ clockedIn: !!open, since: open ? open.clocked_in_at : null });
});

router.post('/clock-in', (req, res) => {
  const open = db.prepare(`SELECT id FROM staff_attendance WHERE staff_id = ? AND clocked_out_at IS NULL`).get(req.staff.id);
  if (open) return res.status(409).json({ error: 'Already clocked in.' });
  db.prepare(`INSERT INTO staff_attendance (staff_id) VALUES (?)`).run(req.staff.id);
  res.json({ ok: true });
});

router.post('/clock-out', (req, res) => {
  const open = db.prepare(
    `SELECT id FROM staff_attendance WHERE staff_id = ? AND clocked_out_at IS NULL ORDER BY id DESC LIMIT 1`
  ).get(req.staff.id);
  if (!open) return res.status(409).json({ error: 'Not clocked in.' });
  db.prepare(`UPDATE staff_attendance SET clocked_out_at = datetime('now') WHERE id = ?`).run(open.id);
  res.json({ ok: true });
});

router.get('/', requireStaff('owner', 'manager'), (req, res) => {
  const rows = db.prepare(
    `SELECT sa.*, s.name FROM staff_attendance sa JOIN staff s ON s.id = sa.staff_id
     ORDER BY sa.clocked_in_at DESC LIMIT 200`
  ).all();
  res.json(rows.map((r) => ({
    id: r.id, staffId: r.staff_id, name: r.name, initials: initialsOf(r.name),
    clockedInAt: r.clocked_in_at, clockedOutAt: r.clocked_out_at,
  })));
});

module.exports = router;
