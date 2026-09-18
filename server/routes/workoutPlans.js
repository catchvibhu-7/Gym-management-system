const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');

const router = express.Router();
router.use(requireStaff());

function loadPlan(id) {
  const plan = db.prepare('SELECT * FROM workout_plans WHERE id = ?').get(id);
  if (!plan) return null;
  const exercises = db.prepare('SELECT * FROM workout_plan_exercises WHERE plan_id = ? ORDER BY sort_order').all(id);
  return { ...plan, exercises };
}

router.get('/member/:memberId', (req, res) => {
  const plans = db.prepare(
    'SELECT id FROM workout_plans WHERE member_id = ? AND active = 1 ORDER BY created_at DESC'
  ).all(req.params.memberId);
  res.json(plans.map((p) => loadPlan(p.id)));
});

router.post('/', (req, res) => {
  const { memberId, title, notes, exercises = [] } = req.body || {};
  if (!memberId || !title) return res.status(400).json({ error: 'Member and title required' });
  const planId = db.prepare(
    `INSERT INTO workout_plans (member_id, created_by, created_by_staff_id, title, notes) VALUES (?, 'staff', ?, ?, ?)`
  ).run(memberId, req.staff.id, title, notes || null).lastInsertRowid;
  const insertEx = db.prepare(
    `INSERT INTO workout_plan_exercises (plan_id, day_of_week, sort_order, name, sets, reps, weight_note, rest_seconds, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  exercises.forEach((e, i) => insertEx.run(planId, e.dayOfWeek || 0, i, e.name, e.sets || null, e.reps || null, e.weightNote || null, e.restSeconds || null, e.notes || null));
  res.status(201).json(loadPlan(planId));
});

router.delete('/:id', (req, res) => {
  db.prepare('UPDATE workout_plans SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
