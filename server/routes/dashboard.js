const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');
const { money, initialsOf, daysAgo, addDays, todayISO, monthlyEquivalentCents } = require('../utils');

const router = express.Router();
router.use(requireStaff());

router.get('/today', (req, res) => {
  const activeMembers = db.prepare(
    `SELECT COUNT(*) c FROM members WHERE status IN ('active','past_due')`
  ).get().c;

  const activeMemberships = db.prepare(
    `SELECT mo.monthly_price_cents amt, mo.billing_period bp FROM memberships mo
     JOIN members m ON m.id = mo.member_id
     WHERE mo.status = 'active' AND m.status IN ('active','past_due')`
  ).all();
  const mrrCents = activeMemberships.reduce((sum, r) => sum + monthlyEquivalentCents(r.amt, r.bp), 0);

  const newThisMonth = db.prepare(
    `SELECT COUNT(*) c FROM members WHERE joined_at >= date('now','start of month')`
  ).get().c;
  const cancelledThisMonth = db.prepare(
    `SELECT COUNT(*) c FROM members WHERE status = 'cancelled' AND joined_at >= date('now','start of month')`
  ).get().c;

  const visitsThisWeek = db.prepare(
    `SELECT COUNT(*) c FROM checkins WHERE checked_in_at >= datetime('now','-7 days')`
  ).get().c;

  const insideNow = db.prepare(
    `SELECT COUNT(*) c FROM checkins WHERE checked_out_at IS NULL AND checked_in_at >= datetime('now','-6 hours')`
  ).get().c;

  // MRR trend, last 6 months (paid membership invoices only)
  const trend = db.prepare(
    `SELECT strftime('%Y-%m', due_date) ym, SUM(amount_cents) total
     FROM invoices WHERE status = 'paid' AND due_date >= date('now','-6 months')
     GROUP BY ym ORDER BY ym`
  ).all();

  // Needs you today: failed invoices, trials ending in <=2 days, frozen resuming soon
  const failedInvoices = db.prepare(
    `SELECT i.id, m.id member_id, m.name, i.amount_cents, i.due_date FROM invoices i
     JOIN members m ON m.id = i.member_id
     WHERE i.status = 'failed' AND i.id = (
       SELECT MAX(i2.id) FROM invoices i2 WHERE i2.member_id = i.member_id AND i2.status = 'failed'
     )
     ORDER BY i.due_date LIMIT 6`
  ).all();
  const trialsEnding = db.prepare(
    `SELECT id, name, joined_at FROM members WHERE status = 'trial' AND joined_at <= date('now','-5 days') LIMIT 4`
  ).all();

  const tasks = [
    ...failedInvoices.map((i) => ({
      memberId: i.member_id, initials: initialsOf(i.name), name: i.name,
      detail: `Payment failed · ${money(i.amount_cents)}`, tag: 'Past due',
      tagStyle: 'color:#b45309', action: 'Retry',
    })),
    ...trialsEnding.map((t) => ({
      memberId: t.id, initials: initialsOf(t.name), name: t.name,
      detail: `Trial started ${daysAgo(t.joined_at)}d ago`, tag: 'Trial ending',
      tagStyle: 'color:#137a5f', action: 'Follow up',
    })),
  ].slice(0, 6);

  const feed = db.prepare(
    `SELECT c.checked_in_at, c.method, COALESCE(m.name, d.name) name FROM checkins c
     LEFT JOIN members m ON m.id = c.member_id
     LEFT JOIN day_passes d ON d.id = c.day_pass_id
     ORDER BY c.checked_in_at DESC LIMIT 8`
  ).all().map((f) => ({
    time: f.checked_in_at.slice(11, 16),
    name: f.name,
    method: f.method === 'qr' ? 'QR' : f.method === 'fob' ? 'Fob' : 'Manual',
  }));

  const todayDow = new Date().getDay();
  const todayClasses = db.prepare(
    `SELECT cs.id, cs.start_at, cl.name, cl.capacity, s.name coach,
       (SELECT COUNT(*) FROM bookings b WHERE b.session_id = cs.id AND b.status IN ('booked','attended')) booked
     FROM class_sessions cs
     JOIN classes cl ON cl.id = cs.class_id
     LEFT JOIN staff s ON s.id = cl.coach_staff_id
     WHERE cs.session_date = ? ORDER BY cs.start_at`
  ).all(todayISO()).map((c) => ({
    time: c.start_at.slice(11, 16), coach: c.coach, name: c.name,
    fillPct: Math.min(100, Math.round((c.booked / c.capacity) * 100)),
    count: `${c.booked}/${c.capacity} booked`,
  }));

  res.json({
    mrr: money(mrrCents), mrrTrend: trend,
    activeMembers, newThisMonth, cancelledThisMonth,
    visitsThisWeek, insideNow, tasks, feed, todayClasses,
  });
});

module.exports = router;
