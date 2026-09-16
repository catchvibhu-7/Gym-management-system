const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');
const { initialsOf } = require('../utils');

const router = express.Router();
router.use(requireStaff());

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', coach: 'Coach', desk: 'Desk staff' };

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

module.exports = router;
