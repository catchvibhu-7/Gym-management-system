const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');
const { money, newCode, todayISO } = require('../utils');

const router = express.Router();
router.use(requireStaff());

router.get('/', (req, res) => {
  const plans = db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY sort_order').all();
  const totalMembers = db.prepare(`SELECT COUNT(*) c FROM members WHERE status IN ('active','past_due')`).get().c || 1;
  const totalRevenue = db.prepare(`SELECT COALESCE(SUM(monthly_price_cents),0) c FROM memberships WHERE status = 'active'`).get().c || 1;

  res.json(plans.map((p) => {
    const memberCount = db.prepare(
      `SELECT COUNT(*) c FROM memberships WHERE plan_id = ? AND status = 'active'`
    ).get(p.id).c;
    const revenue = memberCount * p.price_cents;
    return {
      id: p.id, name: p.name, price: money(p.price_cents), desc: p.description, tag: p.tag,
      members: memberCount, share: `${Math.round((revenue / totalRevenue) * 100)}%`,
      cardStyle: 'background:#fff;border:1px solid #e2e3de;border-radius:14px;padding:20px',
      tagStyle: p.tag ? 'display:inline-block;font-size:11px;font-weight:700;background:#e6f2ed;color:#0e5f4a;padding:4px 9px;border-radius:999px' : '',
      perStyle: 'font-size:13px;color:#6b6f68', descStyle: 'font-size:12.5px;color:#6b6f68;margin:8px 0;line-height:1.5',
      statStyle: 'font-size:12px;color:#6b6f68',
    };
  }));
});

router.get('/day-pass-types', (req, res) => {
  const rows = db.prepare('SELECT * FROM day_pass_types').all();
  res.json(rows.map((t) => ({ id: t.id, name: t.name, price: money(t.price_cents), visits: t.visits })));
});

router.post('/day-passes', (req, res) => {
  const { name, phone, typeId } = req.body || {};
  if (!name || !typeId) return res.status(400).json({ error: 'Name and pass type required' });
  const type = db.prepare('SELECT * FROM day_pass_types WHERE id = ?').get(typeId);
  if (!type) return res.status(404).json({ error: 'Pass type not found' });
  const info = db.prepare(
    `INSERT INTO day_passes (name, phone, type_id, amount_cents, remaining_visits, qr_code, sold_by_staff_id, valid_date)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(name, phone || null, type.id, type.price_cents, type.visits, newCode('DP'), req.staff.id, todayISO());
  res.status(201).json({ id: info.lastInsertRowid, qrCode: db.prepare('SELECT qr_code FROM day_passes WHERE id=?').get(info.lastInsertRowid).qr_code });
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
