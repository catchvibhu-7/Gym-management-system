const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');

const router = express.Router();
router.use(requireStaff());

router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT p.*, m.name member_name, s.name trainer_name, f.name facility_name
     FROM pt_sessions p
     JOIN members m ON m.id = p.member_id
     JOIN staff s ON s.id = p.trainer_staff_id
     LEFT JOIN facilities f ON f.id = p.facility_id
     ORDER BY p.scheduled_at DESC LIMIT 100`
  ).all();
  res.json(rows.map((r) => ({
    id: r.id, memberId: r.member_id, memberName: r.member_name,
    trainerId: r.trainer_staff_id, trainerName: r.trainer_name,
    facilityId: r.facility_id, facilityName: r.facility_name,
    scheduledAt: r.scheduled_at, priceCents: r.price_cents,
    status: r.status, paymentStatus: r.payment_status, paymentMethod: r.payment_method,
  })));
});

// Any active coach/manager/owner who's been given a PT rate is bookable.
// staff_type is shown as a descriptive label only ("Personal Trainer" vs
// "Group Instructor") - it doesn't gate who can be booked, the presence
// of a rate does.
router.get('/trainers', (req, res) => {
  const rows = db.prepare(
    `SELECT id, name, staff_type, pt_rate_cents FROM staff
     WHERE active = 1 AND role IN ('coach','manager','owner') AND pt_rate_cents IS NOT NULL
     ORDER BY name`
  ).all();
  res.json(rows.map((r) => ({ id: r.id, name: r.name, staffType: r.staff_type, rateCents: r.pt_rate_cents })));
});

// Checkout happens before this is ever called (cash confirmed at the desk,
// or an online payment already verified) - a PT session row only exists
// once it's paid, there's no "unpaid session" state to chase down later.
router.post('/', (req, res) => {
  const { memberId, trainerId, facilityId, scheduledAt, paymentMethod, gatewayPaymentId } = req.body || {};
  if (!memberId || !trainerId || !scheduledAt) return res.status(400).json({ error: 'Member, trainer and time are required.' });
  if (!paymentMethod) return res.status(400).json({ error: 'A payment method is required.' });
  const trainer = db.prepare(`SELECT * FROM staff WHERE id = ? AND active = 1`).get(trainerId);
  if (!trainer || trainer.pt_rate_cents == null) return res.status(400).json({ error: 'Trainer is not set up for PT sessions yet (no rate configured).' });
  const member = db.prepare(`SELECT id FROM members WHERE id = ?`).get(memberId);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const info = db.prepare(
    `INSERT INTO pt_sessions (member_id, trainer_staff_id, facility_id, scheduled_at, price_cents, payment_status, payment_method, gateway_payment_id, paid_at, created_by_staff_id)
     VALUES (?,?,?,?,?, 'paid', ?, ?, datetime('now'), ?)`
  ).run(memberId, trainerId, facilityId || null, scheduledAt, trainer.pt_rate_cents, paymentMethod, gatewayPaymentId || null, req.staff.id);
  res.status(201).json({ id: info.lastInsertRowid, priceCents: trainer.pt_rate_cents });
});

router.post('/:id/cancel', (req, res) => {
  const s = db.prepare('SELECT id FROM pt_sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE pt_sessions SET status = 'cancelled' WHERE id = ?`).run(s.id);
  res.json({ ok: true });
});

router.post('/:id/complete', (req, res) => {
  const s = db.prepare('SELECT id FROM pt_sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE pt_sessions SET status = 'completed' WHERE id = ?`).run(s.id);
  res.json({ ok: true });
});

module.exports = router;
