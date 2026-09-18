const express = require('express');
const { db } = require('../db');
const { requireMember } = require('../auth');
const { money, initialsOf } = require('../utils');

const router = express.Router();
router.use(requireMember);

router.get('/me', (req, res) => {
  const m = req.member;
  const membership = db.prepare(
    `SELECT mo.*, p.name plan_name FROM memberships mo JOIN plans p ON p.id = mo.plan_id
     WHERE mo.member_id = ? AND mo.status != 'cancelled' ORDER BY mo.id DESC LIMIT 1`
  ).get(m.id);
  const visitsThisMonth = db.prepare(
    `SELECT COUNT(*) c FROM checkins WHERE member_id = ? AND checked_in_at >= date('now','start of month')`
  ).get(m.id).c;
  const nextClass = db.prepare(
    `SELECT cl.name, cs.start_at, s.name coach, cl.capacity,
       (SELECT COUNT(*) FROM bookings b WHERE b.session_id = cs.id AND b.status IN ('booked','attended')) booked
     FROM bookings b JOIN class_sessions cs ON cs.id = b.session_id JOIN classes cl ON cl.id = cs.class_id
     LEFT JOIN staff s ON s.id = cl.coach_staff_id
     WHERE b.member_id = ? AND cs.start_at >= datetime('now') AND b.status IN ('booked','attended')
     ORDER BY cs.start_at LIMIT 1`
  ).get(m.id);
  const openCheckin = db.prepare(
    `SELECT id FROM checkins WHERE member_id = ? AND checked_out_at IS NULL ORDER BY id DESC LIMIT 1`
  ).get(m.id);

  res.json({
    id: m.id, name: m.name, initials: initialsOf(m.name), status: m.status,
    plan: membership ? membership.plan_name : (m.status === 'trial' ? 'Trial' : '—'),
    nextCharge: membership ? `${membership.next_charge_date} · ${money(membership.monthly_price_cents)}` : null,
    doorCode: m.qr_code,
    visitsThisMonth,
    checkedInNow: !!openCheckin,
    nextClass: nextClass ? {
      name: nextClass.name, at: nextClass.start_at, coach: nextClass.coach,
      spotsLeft: Math.max(0, nextClass.capacity - nextClass.booked),
    } : null,
  });
});

router.post('/checkin', (req, res) => {
  const m = req.member;
  if (m.status === 'frozen' || m.status === 'cancelled') {
    return res.status(403).json({ error: `Membership is ${m.status} — see the desk to check in.` });
  }
  const open = db.prepare(
    `SELECT * FROM checkins WHERE member_id = ? AND checked_out_at IS NULL ORDER BY id DESC LIMIT 1`
  ).get(m.id);
  if (open) {
    db.prepare(`UPDATE checkins SET checked_out_at = datetime('now') WHERE id = ?`).run(open.id);
    return res.json({ action: 'checked_out' });
  }
  db.prepare(`INSERT INTO checkins (member_id, method) VALUES (?, 'manual')`).run(m.id);
  res.json({ action: 'checked_in' });
});

router.get('/classes/upcoming', (req, res) => {
  const rows = db.prepare(
    `SELECT cs.id, cl.name, cs.start_at, cl.capacity, s.name coach,
       (SELECT COUNT(*) FROM bookings b WHERE b.session_id = cs.id AND b.status IN ('booked','attended')) booked,
       (SELECT status FROM bookings b WHERE b.session_id = cs.id AND b.member_id = ? AND b.status IN ('booked','attended','waitlisted') LIMIT 1) myStatus
     FROM class_sessions cs JOIN classes cl ON cl.id = cs.class_id
     LEFT JOIN staff s ON s.id = cl.coach_staff_id
     WHERE cs.start_at >= datetime('now') ORDER BY cs.start_at LIMIT 12`
  ).all(req.member.id);
  // myStatus used to only ever check booked/attended, so a member who was
  // waitlisted (not booked) saw an untouched "Waitlist" button again on
  // their next visit - inviting a duplicate click that just failed with a
  // generic "Already booked" error instead of showing they were already
  // queued.
  res.json(rows.map((r) => ({
    id: r.id, name: r.name, at: r.start_at, coach: r.coach,
    spotsLeft: Math.max(0, r.capacity - r.booked),
    booked: r.myStatus === 'booked' || r.myStatus === 'attended',
    waitlisted: r.myStatus === 'waitlisted',
  })));
});

router.post('/classes/:sessionId/book', (req, res) => {
  const session = db.prepare(
    `SELECT cs.*, cl.capacity FROM class_sessions cs JOIN classes cl ON cl.id = cs.class_id WHERE cs.id = ?`
  ).get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const bookedCount = db.prepare(
    `SELECT COUNT(*) c FROM bookings WHERE session_id = ? AND status IN ('booked','attended')`
  ).get(session.id).c;
  const status = bookedCount < session.capacity ? 'booked' : 'waitlisted';
  try {
    db.prepare('INSERT INTO bookings (session_id, member_id, status) VALUES (?,?,?)').run(session.id, req.member.id, status);
    res.status(201).json({ status });
  } catch (e) {
    res.status(409).json({ error: 'Already booked' });
  }
});

function loadPlan(id) {
  const plan = db.prepare('SELECT * FROM workout_plans WHERE id = ?').get(id);
  if (!plan) return null;
  const exercises = db.prepare('SELECT * FROM workout_plan_exercises WHERE plan_id = ? ORDER BY sort_order').all(id);
  return { ...plan, exercises };
}

router.get('/workout-plans', (req, res) => {
  const plans = db.prepare(
    'SELECT id FROM workout_plans WHERE member_id = ? AND active = 1 ORDER BY created_at DESC'
  ).all(req.member.id);
  res.json(plans.map((p) => loadPlan(p.id)));
});

router.post('/workout-plans', (req, res) => {
  const { title, notes, exercises = [] } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title required' });
  const planId = db.prepare(
    `INSERT INTO workout_plans (member_id, created_by, title, notes) VALUES (?, 'member', ?, ?)`
  ).run(req.member.id, title, notes || null).lastInsertRowid;
  const insertEx = db.prepare(
    `INSERT INTO workout_plan_exercises (plan_id, day_of_week, sort_order, name, sets, reps, weight_note, rest_seconds, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  exercises.forEach((e, i) => insertEx.run(planId, e.dayOfWeek || 0, i, e.name, e.sets || null, e.reps || null, e.weightNote || null, e.restSeconds || null, e.notes || null));
  res.status(201).json(loadPlan(planId));
});

router.put('/workout-plans/:id', (req, res) => {
  const plan = db.prepare('SELECT * FROM workout_plans WHERE id = ? AND member_id = ?').get(req.params.id, req.member.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  const { title, notes, exercises = [] } = req.body || {};
  db.prepare('UPDATE workout_plans SET title = ?, notes = ? WHERE id = ?').run(title || plan.title, notes ?? plan.notes, plan.id);
  db.prepare('DELETE FROM workout_plan_exercises WHERE plan_id = ?').run(plan.id);
  const insertEx = db.prepare(
    `INSERT INTO workout_plan_exercises (plan_id, day_of_week, sort_order, name, sets, reps, weight_note, rest_seconds, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  exercises.forEach((e, i) => insertEx.run(plan.id, e.dayOfWeek || 0, i, e.name, e.sets || null, e.reps || null, e.weightNote || null, e.restSeconds || null, e.notes || null));
  res.json(loadPlan(plan.id));
});

router.delete('/workout-plans/:id', (req, res) => {
  const plan = db.prepare('SELECT * FROM workout_plans WHERE id = ? AND member_id = ?').get(req.params.id, req.member.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE workout_plans SET active = 0 WHERE id = ?').run(plan.id);
  res.json({ ok: true });
});

module.exports = router;
