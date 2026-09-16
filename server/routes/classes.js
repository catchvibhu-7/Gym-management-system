const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');
const { addDays, todayISO } = require('../utils');

const router = express.Router();
router.use(requireStaff());

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

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
