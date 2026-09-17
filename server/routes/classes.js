const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');
const { addDays, todayISO } = require('../utils');

const router = express.Router();
router.use(requireStaff());

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

router.get('/list', (req, res) => {
  const includeInactive = req.query.all === '1';
  const rows = db.prepare(
    `SELECT cl.*, s.name coach_name FROM classes cl LEFT JOIN staff s ON s.id = cl.coach_staff_id
     ${includeInactive ? '' : 'WHERE cl.active = 1'} ORDER BY cl.day_of_week, cl.start_time`
  ).all();
  res.json(rows.map((c) => ({
    id: c.id, name: c.name, coachId: c.coach_staff_id, coach: c.coach_name || 'Unassigned',
    dayOfWeek: c.day_of_week, dayLabel: DAY_LABELS[c.day_of_week],
    startTime: c.start_time, durationMin: c.duration_min, capacity: c.capacity, active: !!c.active,
  })));
});

router.post('/', requireStaff('owner', 'manager'), (req, res) => {
  const { name, coachId, dayOfWeek, startTime, durationMin = 45, capacity = 12 } = req.body || {};
  if (!name || dayOfWeek === undefined || !startTime) {
    return res.status(400).json({ error: 'Name, day of week and start time are required' });
  }
  const info = db.prepare(
    `INSERT INTO classes (name, coach_staff_id, day_of_week, start_time, duration_min, capacity) VALUES (?,?,?,?,?,?)`
  ).run(name, coachId || null, dayOfWeek, startTime, durationMin, capacity);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/:id', requireStaff('owner', 'manager'), (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
  if (!cls) return res.status(404).json({ error: 'Not found' });
  const { name, coachId, dayOfWeek, startTime, durationMin, capacity } = req.body || {};
  db.prepare(
    `UPDATE classes SET name = ?, coach_staff_id = ?, day_of_week = ?, start_time = ?, duration_min = ?, capacity = ? WHERE id = ?`
  ).run(
    name ?? cls.name, coachId !== undefined ? coachId : cls.coach_staff_id,
    dayOfWeek ?? cls.day_of_week, startTime ?? cls.start_time,
    durationMin ?? cls.duration_min, capacity ?? cls.capacity, cls.id
  );
  res.json({ ok: true });
});

router.post('/:id/suspend', requireStaff('owner', 'manager'), (req, res) => {
  db.prepare('UPDATE classes SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/resume', requireStaff('owner', 'manager'), (req, res) => {
  db.prepare('UPDATE classes SET active = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', requireStaff('owner', 'manager'), (req, res) => {
  // Cascades to class_sessions and their bookings (schema FK ON DELETE
  // CASCADE) - the console warns with a confirm dialog before calling this.
  db.prepare('DELETE FROM classes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/week', (req, res) => {
  const today = new Date();
  const monday = addDays(todayISO(), 1 - (today.getDay() === 0 ? 7 : today.getDay()));
  const weekDates = Array.from({ length: 6 }, (_, i) => addDays(monday, i)); // Mon-Sat

  const sessions = db.prepare(
    `SELECT cs.id, cs.session_date, cs.start_at, cl.name, cl.capacity, cl.duration_min, s.name coach,
       (SELECT COUNT(*) FROM bookings b WHERE b.session_id = cs.id AND b.status IN ('booked','attended')) booked
     FROM class_sessions cs JOIN classes cl ON cl.id = cs.class_id
     LEFT JOIN staff s ON s.id = cl.coach_staff_id
     WHERE cs.session_date BETWEEN ? AND ? ORDER BY cs.start_at`
  ).all(weekDates[0], weekDates[5]);

  const totalSessions = sessions.length;
  const totalCapacity = sessions.reduce((sum, s) => sum + s.capacity, 0) || 1;
  const totalBooked = sessions.reduce((sum, s) => sum + s.booked, 0);

  res.json({
    weekStart: weekDates[0],
    summary: `${totalSessions} sessions, ${Math.round((totalBooked / totalCapacity) * 100)}% booked`,
    days: weekDates.map((d, i) => `${DAY_LABELS[new Date(d).getDay()]} ${d.slice(8, 10)}`),
    sessions: sessions.map((s) => ({
      id: s.id, dayIndex: weekDates.indexOf(s.session_date),
      time: s.start_at.slice(11, 16), name: s.name, coach: s.coach,
      meta: `${s.duration_min} min · ${s.coach || 'TBD'}`, booked: s.booked, capacity: s.capacity,
    })),
  });
});

router.post('/:classId/sessions', (req, res) => {
  const { sessionDate, startTime } = req.body || {};
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.classId);
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  const date = sessionDate || todayISO();
  const time = startTime || cls.start_time;
  try {
    const id = db.prepare('INSERT INTO class_sessions (class_id, session_date, start_at) VALUES (?,?,?)')
      .run(cls.id, date, `${date} ${time}:00`).lastInsertRowid;
    res.status(201).json({ id });
  } catch (e) {
    res.status(409).json({ error: 'A session already exists for that class and date' });
  }
});

router.post('/sessions/:sessionId/book', (req, res) => {
  const { memberId } = req.body || {};
  const session = db.prepare(
    `SELECT cs.*, cl.capacity FROM class_sessions cs JOIN classes cl ON cl.id = cs.class_id WHERE cs.id = ?`
  ).get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const bookedCount = db.prepare(
    `SELECT COUNT(*) c FROM bookings WHERE session_id = ? AND status IN ('booked','attended')`
  ).get(session.id).c;
  const status = bookedCount < session.capacity ? 'booked' : 'waitlisted';
  try {
    db.prepare('INSERT INTO bookings (session_id, member_id, status) VALUES (?,?,?)').run(session.id, memberId, status);
    res.status(201).json({ status });
  } catch (e) {
    res.status(409).json({ error: 'Already booked into this session' });
  }
});

router.get('/waitlists', (req, res) => {
  const rows = db.prepare(
    `SELECT cs.id session_id, cl.name, cs.start_at, COUNT(*) waiting
     FROM bookings b JOIN class_sessions cs ON cs.id = b.session_id JOIN classes cl ON cl.id = cs.class_id
     WHERE b.status = 'waitlisted' AND cs.session_date >= date('now')
     GROUP BY cs.id ORDER BY cs.start_at LIMIT 8`
  ).all();
  res.json(rows.map((r) => ({
    name: r.name, when: r.start_at.slice(0, 16).replace('T', ' '), count: r.waiting, sessionId: r.session_id,
  })));
});

module.exports = router;
