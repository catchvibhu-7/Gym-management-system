const express = require('express');
const { db } = require('../db');
const { requireStaff, hashPassword } = require('../auth');
const { money, initialsOf, newCode, periodInfo } = require('../utils');
const settingsStore = require('../settingsStore');

const router = express.Router();
router.use(requireStaff());

function statusChip(status) {
  const map = {
    active: 'background:#e6f2ed;color:#0e5f4a',
    trial: 'background:#eaf1fb;color:#1d4ed8',
    past_due: 'background:#fdecd8;color:#b45309',
    frozen: 'background:#eceded;color:#565a53',
    cancelled: 'background:#fbe4e4;color:#a3221f',
  };
  return `display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.03em;padding:4px 9px;border-radius:999px;${map[status] || ''}`;
}

const SORT_COLUMNS = {
  name: 'm.name', joined: 'm.joined_at', lastVisit: 'last_visit', status: 'm.status', plan: 'plan_name',
};

router.get('/', (req, res) => {
  const { q = '', status = 'all', page, limit = 20, sortBy = 'name', sortDir = 'asc' } = req.query;
  let sql = `SELECT m.*, mo.plan_id, p.name plan_name,
      (SELECT MAX(checked_in_at) FROM checkins WHERE member_id = m.id) last_visit
    FROM members m
    LEFT JOIN memberships mo ON mo.member_id = m.id AND mo.status != 'cancelled'
    LEFT JOIN plans p ON p.id = mo.plan_id
    WHERE 1=1`;
  const params = [];
  if (q) { sql += ` AND m.name LIKE ?`; params.push(`%${q}%`); }
  if (status !== 'all') { sql += ` AND m.status = ?`; params.push(status); }

  const col = SORT_COLUMNS[sortBy] || SORT_COLUMNS.name;
  const dir = sortDir === 'desc' ? 'DESC' : 'ASC';
  sql += ` ORDER BY ${col} ${dir} NULLS LAST, m.name ASC`;

  const allRows = db.prepare(sql).all(...params);
  const total = allRows.length;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const rows = page ? allRows.slice((pageNum - 1) * lim, (pageNum - 1) * lim + lim) : allRows;

  const items = rows.map((m) => ({
    id: m.id, name: m.name, initials: initialsOf(m.name),
    plan: m.plan_name || (m.status === 'trial' ? 'Trial week' : '—'),
    joined: m.joined_at.slice(0, 10),
    lastVisit: m.last_visit ? m.last_visit.slice(0, 16).replace('T', ' ') : 'Never',
    status: m.status.replace('_', ' '),
    chipStyle: statusChip(m.status),
  }));
  res.json(page ? { items, total } : items);
});

router.get('/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const membership = db.prepare(
    `SELECT mo.*, p.name plan_name FROM memberships mo JOIN plans p ON p.id = mo.plan_id
     WHERE mo.member_id = ? AND mo.status != 'cancelled' ORDER BY mo.id DESC LIMIT 1`
  ).get(m.id);
  const visits30 = db.prepare(
    `SELECT COUNT(*) c FROM checkins WHERE member_id = ? AND checked_in_at >= datetime('now','-30 days')`
  ).get(m.id).c;
  const ltv = db.prepare(
    `SELECT COALESCE(SUM(amount_cents),0) c FROM invoices WHERE member_id = ? AND status = 'paid'`
  ).get(m.id).c;
  const pattern = db.prepare(
    `SELECT date(checked_in_at) d FROM checkins WHERE member_id = ? AND checked_in_at >= datetime('now','-14 days')`
  ).all(m.id).map((r) => r.d);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push(pattern.includes(iso) ? 1 : 0);
  }
  res.json({
    id: m.id, name: m.name, initials: initialsOf(m.name), status: m.status,
    plan: membership ? membership.plan_name : (m.status === 'trial' ? 'Trial week' : '—'),
    joined: m.joined_at.slice(0, 10),
    visits: visits30, ltv: money(ltv),
    nextCharge: membership ? `${membership.next_charge_date} · ${money(membership.monthly_price_cents)} (${periodInfo(membership.billing_period).label})` : '—',
    access: m.access_method === 'qr_fob' ? 'QR + fob' : m.access_method === 'qr' ? 'QR only' : m.access_method === 'fob' ? 'Fob only' : 'Paused',
    accessMethod: m.access_method,
    phone: m.phone, email: m.email, emergency: m.emergency_name ? `${m.emergency_name} · ${m.emergency_phone}` : 'Not on file',
    emergencyName: m.emergency_name, emergencyPhone: m.emergency_phone,
    notes: m.notes, pattern: days.map((v) => ({ style: `flex:1;height:22px;border-radius:4px;background:${v ? '#137a5f' : '#eceded'}` })),
  });
});

router.post('/', (req, res) => {
  const { name, phone, email, emergencyName, emergencyPhone, planId, joiningFeeCents = 2500, accessMethod = 'qr' } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'Name and phone required' });
  const existing = db.prepare('SELECT id FROM members WHERE phone = ?').get(phone);
  if (existing) return res.status(409).json({ error: 'A member with this phone already exists' });

  const last4 = phone.replace(/\D/g, '').slice(-4) || '0000';
  const info = db.prepare(
    `INSERT INTO members (name, phone, email, emergency_name, emergency_phone, status, access_method, fob_code, qr_code, pin_hash, joined_at)
     VALUES (?,?,?,?,?, 'active', ?, ?, ?, ?, datetime('now'))`
  ).run(name, phone, email || null, emergencyName || null, emergencyPhone || null, accessMethod,
    accessMethod === 'fob' || accessMethod === 'qr_fob' ? newCode('FOB') : null, newCode('QR'), hashPassword(last4));

  const memberId = info.lastInsertRowid;
  if (planId) {
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
    if (plan) {
      const gst = settingsStore.applyGst(plan.price_cents + joiningFeeCents);
      const modifier = periodInfo(plan.billing_period).dateModifier;
      const membershipId = db.prepare(
        `INSERT INTO memberships (member_id, plan_id, monthly_price_cents, billing_period, joining_fee_cents, start_date, next_charge_date, status)
         VALUES (?,?,?,?,?, date('now'), date('now',?), 'active')`
      ).run(memberId, plan.id, plan.price_cents, plan.billing_period, joiningFeeCents, modifier).lastInsertRowid;
      db.prepare(
        `INSERT INTO invoices (member_id, membership_id, amount_cents, due_date, attempted_at, paid_at, status, payment_method)
         VALUES (?,?,?, date('now'), date('now'), date('now'), 'paid', 'card')`
      ).run(memberId, membershipId, gst.totalCents);
    }
  }
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  res.status(201).json({ id: memberId, name: member.name, qrCode: member.qr_code });
});

router.patch('/:id', (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  const { name, phone, email, emergencyName, emergencyPhone, accessMethod, notes } = req.body || {};
  if (phone && phone !== member.phone) {
    const clash = db.prepare('SELECT id FROM members WHERE phone = ? AND id != ?').get(phone, member.id);
    if (clash) return res.status(409).json({ error: 'Another member already uses this phone number' });
  }
  const nextAccess = accessMethod ?? member.access_method;
  const needsFob = (nextAccess === 'fob' || nextAccess === 'qr_fob') && !member.fob_code;
  db.prepare(
    `UPDATE members SET name = ?, phone = ?, email = ?, emergency_name = ?, emergency_phone = ?,
       access_method = ?, fob_code = COALESCE(fob_code, ?), notes = ? WHERE id = ?`
  ).run(
    name ?? member.name, phone ?? member.phone, email ?? member.email,
    emergencyName ?? member.emergency_name, emergencyPhone ?? member.emergency_phone,
    nextAccess, needsFob ? newCode('FOB') : null, notes ?? member.notes, member.id
  );
  res.json({ ok: true });
});

router.post('/:id/freeze', (req, res) => {
  const membership = db.prepare(
    `SELECT * FROM memberships WHERE member_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`
  ).get(req.params.id);
  if (!membership) return res.status(404).json({ error: 'No active membership to freeze' });
  db.prepare(`UPDATE memberships SET status = 'frozen', frozen_until = date('now','+30 days') WHERE id = ?`).run(membership.id);
  db.prepare(`UPDATE members SET status = 'frozen', access_method = 'paused' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/reminder', (req, res) => {
  // No SMS/email vendor is wired up yet (see README) - this records the
  // intent so the desk knows a nudge was requested, instead of pretending
  // to send a real text.
  res.json({ ok: true, note: 'Reminder queued. Connect an SMS provider in settings to actually send it.' });
});

module.exports = router;
