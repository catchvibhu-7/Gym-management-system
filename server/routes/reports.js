const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');
const { money } = require('../utils');

const router = express.Router();
router.use(requireStaff());

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

module.exports = router;
