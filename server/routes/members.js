const express = require('express');
const { db } = require('../db');
const { requireStaff, hashPassword } = require('../auth');
const { money, initialsOf, newCode, periodInfo, todayISO } = require('../utils');
const settingsStore = require('../settingsStore');
const { sendQrSvg } = require('../qr');

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
  const { q = '', status = 'all', page, limit = 10, sortBy = 'name', sortDir = 'asc' } = req.query;
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
  const lim = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
  const rows = page ? allRows.slice((pageNum - 1) * lim, (pageNum - 1) * lim + lim) : allRows;

  const items = rows.map((m) => ({
    id: m.id, name: m.name, initials: initialsOf(m.name),
    plan: m.plan_name || (m.status === 'trial' ? 'Trial' : '—'),
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
    plan: membership ? membership.plan_name : (m.status === 'trial' ? 'Trial' : '—'),
    joined: m.joined_at.slice(0, 10),
    visits: visits30, ltv: money(ltv),
    nextCharge: membership
      ? `${membership.next_charge_date} · ${money(membership.monthly_price_cents)} (${periodInfo(membership.billing_period).label})`
      : (m.status === 'trial' && m.trial_ends_at ? `Trial ends ${m.trial_ends_at}` : '—'),
    access: m.access_method === 'qr_fob' ? 'QR + fob' : m.access_method === 'qr' ? 'QR only' : m.access_method === 'fob' ? 'Fob only' : 'Paused',
    accessMethod: m.access_method,
    phone: m.phone, email: m.email, emergency: m.emergency_name ? `${m.emergency_name} · ${m.emergency_phone}` : 'Not on file',
    emergencyName: m.emergency_name, emergencyPhone: m.emergency_phone,
    notes: m.notes, pattern: days.map((v) => ({ style: `flex:1;height:22px;border-radius:4px;background:${v ? '#137a5f' : '#eceded'}` })),
    qrCode: m.qr_code, fobCode: m.fob_code, qrSuspended: !!m.qr_suspended, fobSuspended: !!m.fob_suspended,
    fobFeePaid: !!m.fob_fee_paid, admissionFeePaid: !!m.admission_fee_paid, perksUntil: m.perks_until,
    trialEndsAt: m.trial_ends_at,
    hasMembership: !!membership,
    isPastDue: !!membership && membership.next_charge_date < todayISO(),
  });
});

router.post('/', (req, res) => {
  const {
    name, phone, email, emergencyName, emergencyPhone, planId,
    accessMethod = 'qr', isTrial = false, paymentMethod, gatewayPaymentId,
    chargeAdmissionFee = false, chargeFobFee = false,
  } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'Name and phone required' });
  const hasCharge = !isTrial && (planId || chargeAdmissionFee || chargeFobFee);
  if (hasCharge && !paymentMethod) return res.status(400).json({ error: 'A payment method is required.' });
  const existing = db.prepare('SELECT id FROM members WHERE phone = ?').get(phone);
  if (existing) return res.status(409).json({ error: 'A member with this phone already exists' });
  if (email) {
    const emailClash = db.prepare('SELECT id FROM members WHERE email = ?').get(email);
    if (emailClash) return res.status(409).json({ error: 'A member with this email already exists' });
  }

  const last4 = phone.replace(/\D/g, '').slice(-4) || '0000';
  // A trial signup is never a real plan/membership/invoice - just a member
  // record with a QR-only door code that expires after the configured
  // trial length. Fob access and a paid plan are earned by actually joining.
  const finalAccessMethod = isTrial ? 'qr' : accessMethod;
  const wantsFob = finalAccessMethod === 'fob' || finalAccessMethod === 'qr_fob';
  const trialDays = parseInt(settingsStore.get('trial_duration_days'), 10) || 3;
  const trialEndsAt = isTrial ? db.prepare(`SELECT date('now', ?) d`).get(`+${trialDays} days`).d : null;

  // "Admission fee" and "joining fee" were the same one-time charge under
  // two names - now the one configurable amount (admission_fee_cents),
  // opt-in per signup instead of a hardcoded always-on charge. Charging it
  // waives the fob fee, same rule /fob/regenerate already enforces.
  const admissionFeeApplies = !isTrial && !!chargeAdmissionFee;
  const admissionFeeCents = admissionFeeApplies ? (parseInt(settingsStore.get('admission_fee_cents'), 10) || 0) : 0;
  const fobFeeApplies = !isTrial && wantsFob && !!chargeFobFee && !admissionFeeApplies;
  const fobFeeCents = fobFeeApplies ? (parseInt(settingsStore.get('fob_fee_cents'), 10) || 0) : 0;

  const info = db.prepare(
    `INSERT INTO members (name, phone, email, emergency_name, emergency_phone, status, access_method, fob_code, qr_code, pin_hash, joined_at, trial_ends_at, admission_fee_paid, fob_fee_paid)
     VALUES (?,?,?,?,?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)`
  ).run(
    name, phone, email || null, emergencyName || null, emergencyPhone || null,
    isTrial ? 'trial' : 'active', finalAccessMethod,
    wantsFob ? newCode('FOB') : null,
    newCode('QR'), hashPassword(last4), trialEndsAt,
    admissionFeeApplies ? 1 : 0, fobFeeCents > 0 ? 1 : 0
  );

  const memberId = info.lastInsertRowid;
  let membershipId = null;
  let planGstTotal = 0;
  if (!isTrial && planId) {
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
    if (plan) {
      // The plan's own gst_applicable choice only governs the plan's price
      // (false means that price is already GST-inclusive, so GST is backed
      // out of it rather than re-added); the admission/fob fees are separate
      // flat charges and always follow the normal add-it-on-top behaviour.
      const planGst = settingsStore.applyGst(plan.price_cents, !!plan.gst_applicable);
      planGstTotal = planGst.totalCents;
      const modifier = periodInfo(plan.billing_period).dateModifier;
      membershipId = db.prepare(
        `INSERT INTO memberships (member_id, plan_id, monthly_price_cents, billing_period, joining_fee_cents, start_date, next_charge_date, status)
         VALUES (?,?,?,?,?, date('now'), date('now',?), 'active')`
      ).run(memberId, plan.id, plan.price_cents, plan.billing_period, admissionFeeCents, modifier).lastInsertRowid;
    }
  }
  const feesGstTotal = settingsStore.applyGst(admissionFeeCents + fobFeeCents, true).totalCents;
  const invoiceTotal = planGstTotal + feesGstTotal;
  if (!isTrial && invoiceTotal > 0) {
    db.prepare(
      `INSERT INTO invoices (member_id, membership_id, amount_cents, due_date, attempted_at, paid_at, status, payment_method, gateway_payment_id)
       VALUES (?,?,?, date('now'), date('now'), date('now'), 'paid', ?, ?)`
    ).run(memberId, membershipId, invoiceTotal, paymentMethod, gatewayPaymentId || null);
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
  if (email && email !== member.email) {
    const emailClash = db.prepare('SELECT id FROM members WHERE email = ? AND id != ?').get(email, member.id);
    if (emailClash) return res.status(409).json({ error: 'Another member already uses this email' });
  }
  // `?? member.x` only falls back on null/undefined, so an explicit
  // `null` sent to clear an optional field (email/emergency contact/notes -
  // exactly what the Edit details modal sends when a field is blanked out)
  // was indistinguishable from "field omitted, leave alone" and silently
  // kept the old value - clearing any of these was impossible from the UI.
  // `!== undefined` treats an explicit null as "clear it" and only an
  // omitted key as "leave alone".
  const nextAccess = accessMethod !== undefined ? accessMethod : member.access_method;
  const needsFob = (nextAccess === 'fob' || nextAccess === 'qr_fob') && !member.fob_code;
  db.prepare(
    `UPDATE members SET name = ?, phone = ?, email = ?, emergency_name = ?, emergency_phone = ?,
       access_method = ?, fob_code = COALESCE(fob_code, ?), notes = ? WHERE id = ?`
  ).run(
    name !== undefined ? name : member.name, phone !== undefined ? phone : member.phone, email !== undefined ? email : member.email,
    emergencyName !== undefined ? emergencyName : member.emergency_name, emergencyPhone !== undefined ? emergencyPhone : member.emergency_phone,
    nextAccess, needsFob ? newCode('FOB') : null, notes !== undefined ? notes : member.notes, member.id
  );
  res.json({ ok: true });
});

router.post('/:id/freeze', (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  const membership = db.prepare(
    `SELECT * FROM memberships WHERE member_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`
  ).get(req.params.id);
  if (!membership) return res.status(404).json({ error: 'No active membership to freeze' });
  db.prepare(`UPDATE memberships SET status = 'frozen', frozen_until = date('now','+30 days') WHERE id = ?`).run(membership.id);
  db.prepare(
    `UPDATE members SET status = 'frozen', access_method = 'paused', pre_freeze_access_method = ? WHERE id = ?`
  ).run(member.access_method, member.id);
  res.json({ ok: true });
});

router.post('/:id/unfreeze', (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  const membership = db.prepare(
    `SELECT * FROM memberships WHERE member_id = ? AND status = 'frozen' ORDER BY id DESC LIMIT 1`
  ).get(req.params.id);
  if (!membership) return res.status(404).json({ error: 'No frozen membership to unfreeze' });
  db.prepare(`UPDATE memberships SET status = 'active', frozen_until = NULL WHERE id = ?`).run(membership.id);
  const restoredAccess = member.pre_freeze_access_method || (member.fob_code ? 'qr_fob' : 'qr');
  db.prepare(
    `UPDATE members SET status = 'active', access_method = ?, pre_freeze_access_method = NULL WHERE id = ?`
  ).run(restoredAccess, member.id);
  res.json({ ok: true });
});

// A no-charge push of the next billing date - goodwill for a gym closure,
// a service issue, a referral bonus, etc. - available any time, unlike
// "Bill now" (billing.js) which only makes sense once a cycle is actually
// due. Also clears past_due, since staff deliberately moving the date out
// means it's no longer overdue by definition.
router.post('/:id/membership/extend', (req, res) => {
  const membership = db.prepare(
    `SELECT * FROM memberships WHERE member_id = ? AND status != 'cancelled' ORDER BY id DESC LIMIT 1`
  ).get(req.params.id);
  if (!membership) return res.status(404).json({ error: 'No membership to extend.' });
  const amount = parseInt(req.body?.amount, 10);
  const unit = req.body?.unit;
  if (!amount || amount <= 0 || !['days', 'weeks', 'months'].includes(unit)) {
    return res.status(400).json({ error: 'Enter a valid amount and unit.' });
  }
  db.prepare(`UPDATE memberships SET next_charge_date = date(next_charge_date, ?) WHERE id = ?`)
    .run(`+${amount} ${unit}`, membership.id);
  db.prepare(`UPDATE members SET status = 'active' WHERE id = ? AND status = 'past_due'`).run(req.params.id);
  const updated = db.prepare('SELECT next_charge_date FROM memberships WHERE id = ?').get(membership.id);
  res.json({ ok: true, nextChargeDate: updated.next_charge_date });
});

router.post('/:id/reminder', (req, res) => {
  // No SMS/email vendor is wired up yet (see README) - this records the
  // intent so the desk knows a nudge was requested, instead of pretending
  // to send a real text.
  res.json({ ok: true, note: 'Reminder queued. Connect an SMS provider in settings to actually send it.' });
});

router.get('/:id/qr-code.svg', (req, res) => {
  const member = db.prepare('SELECT qr_code FROM members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).end();
  sendQrSvg(res, member.qr_code);
});

router.post('/:id/qr/regenerate', (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  const code = newCode('QR');
  db.prepare('UPDATE members SET qr_code = ?, qr_suspended = 0 WHERE id = ?').run(code, member.id);
  res.json({ ok: true, qrCode: code });
});

router.post('/:id/qr/suspend', (req, res) => {
  db.prepare('UPDATE members SET qr_suspended = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/qr/resume', (req, res) => {
  db.prepare('UPDATE members SET qr_suspended = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/fob/regenerate', (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  const chargeFee = !!(req.body && req.body.chargeFee);
  const code = newCode('FOB');
  const nextAccess = member.access_method === 'qr' ? 'qr_fob' : (member.access_method === 'paused' ? 'fob' : member.access_method);
  db.prepare('UPDATE members SET fob_code = ?, fob_suspended = 0, access_method = ? WHERE id = ?').run(code, nextAccess, member.id);

  let invoice = null;
  // Waived if the admission fee already covers it, or if the fob fee
  // itself was already paid once - re-issuing a lost/replaced fob for an
  // already-paid member shouldn't charge them a second time.
  if (chargeFee && !member.admission_fee_paid && !member.fob_fee_paid) {
    const feeCents = parseInt(settingsStore.get('fob_fee_cents'), 10) || 0;
    if (feeCents > 0) {
      const gst = settingsStore.applyGst(feeCents);
      db.prepare(
        `INSERT INTO invoices (member_id, amount_cents, due_date, attempted_at, paid_at, status, payment_method)
         VALUES (?,?, date('now'), date('now'), date('now'), 'paid', 'card')`
      ).run(member.id, gst.totalCents);
      db.prepare('UPDATE members SET fob_fee_paid = 1 WHERE id = ?').run(member.id);
      invoice = { amount: money(gst.totalCents) };
    }
  }
  res.json({ ok: true, fobCode: code, invoice });
});

router.post('/:id/fob/suspend', (req, res) => {
  db.prepare('UPDATE members SET fob_suspended = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/fob/resume', (req, res) => {
  db.prepare('UPDATE members SET fob_suspended = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/admission-fee', (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  if (member.admission_fee_paid) return res.status(409).json({ error: 'Admission fee already paid for this member.' });
  const feeCents = parseInt(settingsStore.get('admission_fee_cents'), 10) || 0;
  const perksDays = parseInt(settingsStore.get('admission_perks_days'), 10) || 30;
  const gst = settingsStore.applyGst(feeCents);
  if (feeCents > 0) {
    db.prepare(
      `INSERT INTO invoices (member_id, amount_cents, due_date, attempted_at, paid_at, status, payment_method)
       VALUES (?,?, date('now'), date('now'), date('now'), 'paid', 'card')`
    ).run(member.id, gst.totalCents);
  }
  db.prepare(
    `UPDATE members SET admission_fee_paid = 1, perks_until = date('now', ?) WHERE id = ?`
  ).run(`+${perksDays} days`, member.id);
  res.json({ ok: true, amount: money(gst.totalCents), perksUntil: db.prepare('SELECT perks_until FROM members WHERE id = ?').get(member.id).perks_until });
});

module.exports = router;
