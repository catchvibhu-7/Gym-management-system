const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');
const { money } = require('../utils');

const router = express.Router();
router.use(requireStaff());

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers, rows) {
  return [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
}
function monthRange(req) {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  return { month, from: `${month}-01`, to: `${month}-31` };
}
function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

router.get('/revenue', (req, res) => {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  const membershipRows = db.prepare(
    `SELECT strftime('%Y-%m', due_date) ym, SUM(amount_cents) total FROM invoices
     WHERE status = 'paid' AND due_date >= date('now','-6 months') GROUP BY ym`
  ).all();
  const dayPassRows = db.prepare(
    `SELECT strftime('%Y-%m', sold_at) ym, SUM(amount_cents) total FROM day_passes
     WHERE sold_at >= date('now','-6 months') GROUP BY ym`
  ).all();
  const memMap = new Map(membershipRows.map((r) => [r.ym, r.total]));
  const dpMap = new Map(dayPassRows.map((r) => [r.ym, r.total]));
  const maxTotal = Math.max(1, ...months.map((m) => (memMap.get(m) || 0) + (dpMap.get(m) || 0)));

  res.json(months.map((m) => {
    const mem = memMap.get(m) || 0;
    const dp = dpMap.get(m) || 0;
    const total = mem + dp;
    return {
      month: new Date(`${m}-01`).toLocaleString('en-US', { month: 'short' }),
      total: money(total),
      stackStyle: 'display:flex;flex-direction:column-reverse;height:100%;border-radius:4px 4px 0 0;overflow:hidden',
      aStyle: `background:#137a5f;height:${Math.round((mem / maxTotal) * 100)}%`,
      bStyle: 'height:0%',
      cStyle: `background:#cbd8d2;height:${Math.round((dp / maxTotal) * 100)}%`,
    };
  }));
});

router.get('/stats', (req, res) => {
  const activeStart = db.prepare(`SELECT COUNT(*) c FROM members WHERE joined_at < date('now','-30 days') AND status != 'cancelled'`).get().c || 1;
  const cancelledLast30 = db.prepare(`SELECT COUNT(*) c FROM members WHERE status = 'cancelled' AND joined_at >= date('now','-30 days')`).get().c;
  const churn = ((cancelledLast30 / activeStart) * 100).toFixed(1);
  const avgVisits = db.prepare(
    `SELECT AVG(c) FROM (SELECT COUNT(*) c FROM checkins WHERE checked_in_at >= date('now','-30 days') GROUP BY member_id)`
  ).get()['AVG(c)'] || 0;
  const capacity = db.prepare(
    `SELECT AVG(booked * 1.0 / capacity) avgFill FROM (
       SELECT cl.capacity, COUNT(b.id) booked FROM class_sessions cs
       JOIN classes cl ON cl.id = cs.class_id
       LEFT JOIN bookings b ON b.session_id = cs.id AND b.status IN ('booked','attended')
       WHERE cs.session_date >= date('now','-14 days') GROUP BY cs.id)`
  ).get().avgFill || 0;

  res.json([
    { label: 'Monthly churn', value: `${churn}%`, note: `${cancelledLast30} cancelled in the last 30 days` },
    { label: 'Avg visits / member', value: avgVisits.toFixed(1), note: 'Rolling 30 days' },
    { label: 'Class fill rate', value: `${Math.round(capacity * 100)}%`, note: 'Last 14 days of sessions' },
  ]);
});

// CSV exports - owner/manager only (invoices/payment data), one file per
// area rather than one giant combined export, since each has a different
// natural row shape and an auditor/accountant usually wants them separate.
const EXPORT_ROLES = ['owner', 'manager'];

router.get('/export/invoices.csv', requireStaff(...EXPORT_ROLES), (req, res) => {
  const { month, from, to } = monthRange(req);
  const rows = db.prepare(
    `SELECT i.id, m.name member_name, m.phone member_phone, i.amount_cents, i.status,
            i.payment_method, i.gateway_payment_id, i.due_date, i.attempted_at, i.paid_at, i.retry_count
     FROM invoices i JOIN members m ON m.id = i.member_id
     WHERE i.due_date >= ? AND i.due_date <= ? ORDER BY i.due_date, i.id`
  ).all(from, to);
  const csv = toCsv(
    ['Invoice ID', 'Member', 'Phone', 'Amount (cents)', 'Status', 'Payment method', 'Gateway payment ID', 'Due date', 'Attempted at', 'Paid at', 'Retry count'],
    rows.map((r) => [r.id, r.member_name, r.member_phone, r.amount_cents, r.status, r.payment_method, r.gateway_payment_id, r.due_date, r.attempted_at, r.paid_at, r.retry_count])
  );
  sendCsv(res, `invoices-${month}.csv`, csv);
});

router.get('/export/checkins.csv', requireStaff(...EXPORT_ROLES), (req, res) => {
  const { month, from, to } = monthRange(req);
  const rows = db.prepare(
    `SELECT c.id, COALESCE(m.name, d.name) name, COALESCE(m.phone, '') phone, c.method,
            c.checked_in_at, c.checked_out_at,
            CAST((julianday(COALESCE(c.checked_out_at, datetime('now'))) - julianday(c.checked_in_at)) * 1440 AS INTEGER) duration_mins
     FROM checkins c
     LEFT JOIN members m ON m.id = c.member_id
     LEFT JOIN day_passes d ON d.id = c.day_pass_id
     WHERE date(c.checked_in_at) >= ? AND date(c.checked_in_at) <= ? ORDER BY c.checked_in_at`
  ).all(from, to);
  const csv = toCsv(
    ['Checkin ID', 'Name', 'Phone', 'Method', 'Checked in at', 'Checked out at', 'Duration (mins)'],
    rows.map((r) => [r.id, r.name, r.phone, r.method, r.checked_in_at, r.checked_out_at, r.duration_mins])
  );
  sendCsv(res, `checkins-${month}.csv`, csv);
});

router.get('/export/access-alerts.csv', requireStaff(...EXPORT_ROLES), (req, res) => {
  const { month, from, to } = monthRange(req);
  const rows = db.prepare(
    `SELECT a.id, m.name member_name, m.phone member_phone, a.method, a.reason, a.created_at, a.acknowledged
     FROM access_alerts a LEFT JOIN members m ON m.id = a.member_id
     WHERE date(a.created_at) >= ? AND date(a.created_at) <= ? ORDER BY a.created_at`
  ).all(from, to);
  const csv = toCsv(
    ['Alert ID', 'Member', 'Phone', 'Method', 'Reason', 'Timestamp', 'Acknowledged'],
    rows.map((r) => [r.id, r.member_name, r.member_phone, r.method, r.reason, r.created_at, r.acknowledged ? 'Yes' : 'No'])
  );
  sendCsv(res, `access-denied-log-${month}.csv`, csv);
});

// A point-in-time roster snapshot, not scoped to the month - an auditor
// checking a given month's invoices/checkins also wants to know who was
// actually a member and what their status/plan was, without cross-
// referencing every invoice back to a live members list that keeps changing.
router.get('/export/members.csv', requireStaff(...EXPORT_ROLES), (req, res) => {
  const rows = db.prepare(
    `SELECT m.id, m.name, m.phone, m.email, m.status, m.access_method, m.joined_at,
            p.name plan_name, mo.billing_period, mo.monthly_price_cents
     FROM members m
     LEFT JOIN memberships mo ON mo.member_id = m.id AND mo.status = 'active'
     LEFT JOIN plans p ON p.id = mo.plan_id
     ORDER BY m.id`
  ).all();
  const csv = toCsv(
    ['Member ID', 'Name', 'Phone', 'Email', 'Status', 'Access method', 'Joined at', 'Plan', 'Billing period', 'Price (cents)'],
    rows.map((r) => [r.id, r.name, r.phone, r.email, r.status, r.access_method, r.joined_at, r.plan_name, r.billing_period, r.monthly_price_cents])
  );
  sendCsv(res, `members-roster-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

module.exports = router;
