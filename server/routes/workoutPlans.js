const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');
const settingsStore = require('../settingsStore');

const router = express.Router();
router.use(requireStaff());

function loadPlan(id) {
  const plan = db.prepare('SELECT * FROM workout_plans WHERE id = ?').get(id);
  if (!plan) return null;
  const exercises = db.prepare('SELECT * FROM workout_plan_exercises WHERE plan_id = ? ORDER BY week_number, sort_order').all(id);
  return { ...plan, exercises };
}

function insertExercises(planId, exercises) {
  const insertEx = db.prepare(
    `INSERT INTO workout_plan_exercises (plan_id, week_number, day_of_week, section, sort_order, name, sets, reps, weight_note, rest_seconds, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  exercises.forEach((e, i) => insertEx.run(
    planId, e.weekNumber || 1, e.dayOfWeek || 0, e.section || 'workout', i,
    e.name, e.sets || null, e.reps || null, e.weightNote || null, e.restSeconds || null, e.notes || null
  ));
}

router.get('/member/:memberId', (req, res) => {
  const plans = db.prepare(
    'SELECT id FROM workout_plans WHERE member_id = ? AND is_template = 0 AND active = 1 ORDER BY created_at DESC'
  ).all(req.params.memberId);
  res.json(plans.map((p) => loadPlan(p.id)));
});

// A one-off plan built directly for a single member - unchanged from
// before the plan library existed, still the "+ Add" path in the member
// detail panel.
router.post('/', (req, res) => {
  const { memberId, title, notes, exercises = [] } = req.body || {};
  if (!memberId || !title) return res.status(400).json({ error: 'Member and title required' });
  const planId = db.prepare(
    `INSERT INTO workout_plans (member_id, created_by, created_by_staff_id, title, notes) VALUES (?, 'staff', ?, ?, ?)`
  ).run(memberId, req.staff.id, title, notes || null).lastInsertRowid;
  insertExercises(planId, exercises);
  res.status(201).json(loadPlan(planId));
});

router.delete('/:id', (req, res) => {
  db.prepare('UPDATE workout_plans SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Plan library (reusable templates) ----------
// A template is a workout_plans row with no member_id yet (is_template=1).
// Assigning one to a member COPIES its exercises into a brand new,
// independent instance rather than pointing at the template - matches the
// existing rule that a member's own plan is always their own editable
// copy, and means a later edit to the template (or another member's copy)
// never silently changes what someone already has.
function visibleTemplatesFor(staff) {
  if (staff.role === 'owner' || staff.role === 'manager') {
    return db.prepare(`SELECT * FROM workout_plans WHERE is_template = 1 AND active = 1 ORDER BY created_at DESC`).all();
  }
  if (staff.role === 'coach') {
    return db.prepare(
      `SELECT * FROM workout_plans WHERE is_template = 1 AND active = 1
       AND (visibility = 'universal' OR (visibility = 'trainer' AND created_by_staff_id = ?))
       ORDER BY created_at DESC`
    ).all(staff.id);
  }
  return db.prepare(`SELECT * FROM workout_plans WHERE is_template = 1 AND active = 1 AND visibility = 'universal' ORDER BY created_at DESC`).all();
}

router.get('/templates', (req, res) => {
  const templates = visibleTemplatesFor(req.staff);
  const trainerIds = [...new Set(templates.filter((t) => t.visibility === 'trainer').map((t) => t.created_by_staff_id))];
  const trainers = trainerIds.length
    ? db.prepare(`SELECT id, name FROM staff WHERE id IN (${trainerIds.map(() => '?').join(',')})`).all(...trainerIds)
    : [];
  const trainerName = (id) => trainers.find((t) => t.id === id)?.name || 'Unknown trainer';
  res.json(templates.map((t) => ({
    ...t, exerciseCount: db.prepare('SELECT COUNT(*) c FROM workout_plan_exercises WHERE plan_id = ?').get(t.id).c,
    trainerName: t.visibility === 'trainer' ? trainerName(t.created_by_staff_id) : null,
  })));
});

router.post('/templates', requireStaff('owner', 'manager', 'coach'), (req, res) => {
  const { title, notes, planType = 'weekly', visibility, priceCents = 0, exercises = [] } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title required' });
  if (!['weekly', 'monthly'].includes(planType)) return res.status(400).json({ error: 'Invalid plan type' });
  // The client's requested visibility is only a suggestion - who can
  // actually publish what is decided here, not trusted from the request.
  const isManager = req.staff.role === 'owner' || req.staff.role === 'manager';
  const finalVisibility = isManager ? (visibility === 'universal' ? 'universal' : 'trainer') : 'trainer';
  if (finalVisibility === 'trainer' && req.staff.role !== 'coach' && !isManager) {
    return res.status(403).json({ error: 'Only a coach or owner/manager can publish a plan.' });
  }
  const finalPriceCents = finalVisibility === 'universal' ? Math.max(0, parseInt(priceCents, 10) || 0) : 0;
  const planId = db.prepare(
    `INSERT INTO workout_plans (member_id, created_by, created_by_staff_id, title, notes, is_template, plan_type, visibility, price_cents)
     VALUES (NULL, 'staff', ?, ?, ?, 1, ?, ?, ?)`
  ).run(req.staff.id, title, notes || null, planType, finalVisibility, finalPriceCents).lastInsertRowid;
  insertExercises(planId, exercises);
  res.status(201).json(loadPlan(planId));
});

router.delete('/templates/:id', (req, res) => {
  const template = db.prepare('SELECT * FROM workout_plans WHERE id = ? AND is_template = 1').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Not found' });
  const isManager = req.staff.role === 'owner' || req.staff.role === 'manager';
  const isOwnTrainerPlan = template.visibility === 'trainer' && template.created_by_staff_id === req.staff.id;
  if (!isManager && !isOwnTrainerPlan) return res.status(403).json({ error: "You can only remove your own plans." });
  db.prepare('UPDATE workout_plans SET active = 0 WHERE id = ?').run(template.id);
  res.json({ ok: true });
});

router.post('/templates/:id/assign', (req, res) => {
  const template = db.prepare('SELECT * FROM workout_plans WHERE id = ? AND is_template = 1 AND active = 1').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Not found' });
  const { memberId, paymentMethod, gatewayPaymentId } = req.body || {};
  const member = db.prepare('SELECT id FROM members WHERE id = ?').get(memberId);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const isManager = req.staff.role === 'owner' || req.staff.role === 'manager';
  if (template.visibility === 'trainer' && !isManager && template.created_by_staff_id !== req.staff.id) {
    return res.status(403).json({ error: "You can only assign your own plans." });
  }

  // Never re-copy (or re-charge for) a template the member already has an
  // active instance of.
  const already = db.prepare(
    `SELECT id FROM workout_plans WHERE member_id = ? AND source_template_id = ? AND active = 1`
  ).get(member.id, template.id);
  if (already) return res.status(409).json({ error: 'This member already has this plan.' });

  if (template.price_cents > 0) {
    if (!paymentMethod) return res.status(400).json({ error: 'A payment method is required for a paid plan.' });
  }

  const exercises = db.prepare('SELECT * FROM workout_plan_exercises WHERE plan_id = ? ORDER BY week_number, sort_order').all(template.id);
  const planId = db.prepare(
    `INSERT INTO workout_plans (member_id, created_by, created_by_staff_id, title, notes, plan_type, source_template_id)
     VALUES (?, 'staff', ?, ?, ?, ?, ?)`
  ).run(member.id, req.staff.id, template.title, template.notes, template.plan_type, template.id).lastInsertRowid;
  const insertEx = db.prepare(
    `INSERT INTO workout_plan_exercises (plan_id, week_number, day_of_week, section, sort_order, name, sets, reps, weight_note, rest_seconds, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  exercises.forEach((e) => insertEx.run(
    planId, e.week_number, e.day_of_week, e.section, e.sort_order,
    e.name, e.sets, e.reps, e.weight_note, e.rest_seconds, e.notes
  ));

  if (template.price_cents > 0) {
    const gst = settingsStore.applyGst(template.price_cents, true);
    db.prepare(
      `INSERT INTO invoices (member_id, amount_cents, due_date, attempted_at, paid_at, status, payment_method, gateway_payment_id)
       VALUES (?,?, date('now'), date('now'), date('now'), 'paid', ?, ?)`
    ).run(member.id, gst.totalCents, paymentMethod, gatewayPaymentId || null);
  }
  res.status(201).json(loadPlan(planId));
});

module.exports = router;
