const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');
const { money, newCode, todayISO, periodInfo, monthlyEquivalentCents, BILLING_PERIODS } = require('../utils');
const { sendQrSvg } = require('../qr');

const router = express.Router();
router.use(requireStaff());

router.get('/periods', (req, res) => {
  res.json(Object.entries(BILLING_PERIODS).map(([value, info]) => ({ value, label: info.label })));
});

router.get('/', (req, res) => {
  const includeInactive = req.query.all === '1';
  const plans = db.prepare(`SELECT * FROM plans ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort_order, id`).all();
  const totalRevenue = db.prepare(
    `SELECT mo.monthly_price_cents amt, mo.billing_period bp FROM memberships mo WHERE mo.status = 'active'`
  ).all().reduce((sum, r) => sum + monthlyEquivalentCents(r.amt, r.bp), 0) || 1;

  res.json(plans.map((p) => {
    const memberCount = db.prepare(
      `SELECT COUNT(*) c FROM memberships WHERE plan_id = ? AND status = 'active'`
    ).get(p.id).c;
    const monthlyEq = monthlyEquivalentCents(p.price_cents, p.billing_period) * memberCount;
    return {
      id: p.id, name: p.name, price: money(p.price_cents), priceCents: p.price_cents,
      billingPeriod: p.billing_period, periodLabel: periodInfo(p.billing_period).label,
      desc: p.description, tag: p.tag, active: !!p.active,
      members: memberCount, share: `${Math.round((monthlyEq / totalRevenue) * 100)}%`,
      cardStyle: 'background:#fff;border:1px solid #e2e3de;border-radius:14px;padding:20px',
      tagStyle: p.tag ? 'display:inline-block;font-size:11px;font-weight:700;background:#e6f2ed;color:#0e5f4a;padding:4px 9px;border-radius:999px' : '',
      perStyle: 'font-size:13px;color:#6b6f68', descStyle: 'font-size:12.5px;color:#6b6f68;margin:8px 0;line-height:1.5',
      statStyle: 'font-size:12px;color:#6b6f68',
    };
  }));
});

router.post('/', requireStaff('owner', 'manager'), (req, res) => {
  const { name, priceCents, billingPeriod = 'monthly', description, tag } = req.body || {};
  if (!name || !priceCents || priceCents <= 0) return res.status(400).json({ error: 'Name and a positive price are required' });
  if (!BILLING_PERIODS[billingPeriod]) return res.status(400).json({ error: 'Invalid billing period' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM plans').get().m;
  const info = db.prepare(
    `INSERT INTO plans (name, price_cents, billing_period, description, tag, sort_order) VALUES (?,?,?,?,?,?)`
  ).run(name, priceCents, billingPeriod, description || null, tag || null, maxOrder + 1);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/:id', requireStaff('owner', 'manager'), (req, res) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  const { name, priceCents, billingPeriod, description, tag } = req.body || {};
  if (billingPeriod && !BILLING_PERIODS[billingPeriod]) return res.status(400).json({ error: 'Invalid billing period' });
  db.prepare(
    `UPDATE plans SET name = ?, price_cents = ?, billing_period = ?, description = ?, tag = ? WHERE id = ?`
  ).run(
    name ?? plan.name, priceCents ?? plan.price_cents, billingPeriod ?? plan.billing_period,
    description ?? plan.description, tag ?? plan.tag, plan.id
  );
  res.json({ ok: true });
});

router.post('/:id/deactivate', requireStaff('owner', 'manager'), (req, res) => {
  db.prepare('UPDATE plans SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/reactivate', requireStaff('owner', 'manager'), (req, res) => {
  db.prepare('UPDATE plans SET active = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/day-pass-types', (req, res) => {
  const includeInactive = req.query.all === '1';
  const rows = db.prepare(`SELECT * FROM day_pass_types ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY id`).all();
  res.json(rows.map((t) => ({
    id: t.id, name: t.name, price: money(t.price_cents), priceCents: t.price_cents, visits: t.visits, active: !!t.active,
  })));
});

router.post('/day-pass-types', requireStaff('owner', 'manager'), (req, res) => {
  const { name, priceCents, visits = 1 } = req.body || {};
  if (!name || !priceCents || priceCents <= 0) return res.status(400).json({ error: 'Name and a positive price are required' });
  const info = db.prepare('INSERT INTO day_pass_types (name, price_cents, visits) VALUES (?,?,?)').run(name, priceCents, visits);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/day-pass-types/:id', requireStaff('owner', 'manager'), (req, res) => {
  const type = db.prepare('SELECT * FROM day_pass_types WHERE id = ?').get(req.params.id);
  if (!type) return res.status(404).json({ error: 'Not found' });
  const { name, priceCents, visits } = req.body || {};
  if (priceCents !== undefined && priceCents <= 0) return res.status(400).json({ error: 'Price must be positive' });
  db.prepare('UPDATE day_pass_types SET name = ?, price_cents = ?, visits = ? WHERE id = ?').run(
    name ?? type.name, priceCents ?? type.price_cents, visits ?? type.visits, type.id
  );
  res.json({ ok: true });
});

router.delete('/day-pass-types/:id', requireStaff('owner', 'manager'), (req, res) => {
  const inUse = db.prepare('SELECT COUNT(*) c FROM day_passes WHERE type_id = ?').get(req.params.id).c;
  if (inUse) return res.status(409).json({ error: `${inUse} day pass(es) already sold under this type — can't delete it.` });
  db.prepare('DELETE FROM day_pass_types WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/day-pass-types/:id/deactivate', requireStaff('owner', 'manager'), (req, res) => {
  db.prepare('UPDATE day_pass_types SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/day-pass-types/:id/reactivate', requireStaff('owner', 'manager'), (req, res) => {
  db.prepare('UPDATE day_pass_types SET active = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/day-passes', (req, res) => {
  const { name, phone, typeId, paymentMethod, gatewayPaymentId } = req.body || {};
  if (!name || !typeId) return res.status(400).json({ error: 'Name and pass type required' });
  if (!paymentMethod) return res.status(400).json({ error: 'A payment method is required.' });
  const type = db.prepare('SELECT * FROM day_pass_types WHERE id = ?').get(typeId);
  if (!type) return res.status(404).json({ error: 'Pass type not found' });
  const info = db.prepare(
    `INSERT INTO day_passes (name, phone, type_id, amount_cents, remaining_visits, qr_code, sold_by_staff_id, valid_date, payment_method, gateway_payment_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(name, phone || null, type.id, type.price_cents, type.visits, newCode('DP'), req.staff.id, todayISO(), paymentMethod, gatewayPaymentId || null);
  res.status(201).json({ id: info.lastInsertRowid, qrCode: db.prepare('SELECT qr_code FROM day_passes WHERE id=?').get(info.lastInsertRowid).qr_code });
});

// Mirrors GET /members/:id/qr-code.svg - the day pass's qr_code is what
// /api/checkins/scan actually matches against, but until now nothing ever
// rendered it, so a sold day pass had no scannable code the desk could show
// or print for the walk-in to use at the kiosk.
router.get('/day-passes/:id/qr-code.svg', (req, res) => {
  const pass = db.prepare('SELECT qr_code FROM day_passes WHERE id = ?').get(req.params.id);
  if (!pass) return res.status(404).end();
  sendQrSvg(res, pass.qr_code);
});

router.get('/day-passes/summary', (req, res) => {
  const rows = db.prepare(
    `SELECT dpt.name, COUNT(*) sold FROM day_passes dp JOIN day_pass_types dpt ON dpt.id = dp.type_id
     WHERE dp.sold_at >= date('now','start of month') GROUP BY dpt.id`
  ).all();
  res.json(rows);
});

router.get('/moves', (req, res) => {
  // Recent joins and cancellations stand in for "plan moves" - real plan
  // upgrade/downgrade tracking would need a change-log table this MVP
  // doesn't have yet.
  const recent = db.prepare(
    `SELECT m.name, m.status, m.joined_at FROM members m
     WHERE m.joined_at >= date('now','-30 days') ORDER BY m.joined_at DESC LIMIT 6`
  ).all();
  res.json(recent.map((m) => ({
    name: m.name, dir: m.status === 'cancelled' ? '↓' : '↑',
    dirStyle: `font-weight:700;color:${m.status === 'cancelled' ? '#a3221f' : '#0e5f4a'}`,
    move: m.status === 'cancelled' ? 'Cancelled' : 'Joined',
  })));
});

module.exports = router;
