const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');
const { money, initialsOf } = require('../utils');

const router = express.Router();
router.use(requireStaff());

function chip(status) {
  const map = {
    paid: 'background:#e6f2ed;color:#0e5f4a',
    pending: 'background:#eceded;color:#565a53',
    failed: 'background:#fbe4e4;color:#a3221f',
  };
  return `display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.03em;padding:4px 9px;border-radius:999px;${map[status] || ''}`;
}

router.get('/stats', (req, res) => {
  const mrr = db.prepare(
    `SELECT COALESCE(SUM(monthly_price_cents),0) c FROM memberships WHERE status = 'active'`
  ).get().c;
  const collectedThisMonth = db.prepare(
    `SELECT COALESCE(SUM(amount_cents),0) c FROM invoices WHERE status = 'paid' AND paid_at >= date('now','start of month')`
  ).get().c;
  const failedCount = db.prepare(`SELECT COUNT(*) c FROM invoices WHERE status = 'failed'`).get().c;
  const failedAmount = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) c FROM invoices WHERE status = 'failed'`).get().c;
  const memberCount = db.prepare(`SELECT COUNT(*) c FROM members WHERE status IN ('active','past_due')`).get().c;

  res.json({
    stats: [
      { label: 'Monthly recurring revenue', value: money(mrr), note: `${memberCount} active memberships` },
      { label: 'Collected this month', value: money(collectedThisMonth), note: 'Paid invoices, current month' },
      { label: 'Failed payments', value: String(failedCount), note: `${money(failedAmount)} to recover` },
      { label: 'Active members', value: String(memberCount), note: 'Billed monthly' },
    ],
  });
});

router.get('/invoices', (req, res) => {
  const rows = db.prepare(
    `SELECT i.*, m.name member_name, p.name plan_name FROM invoices i
     JOIN members m ON m.id = i.member_id
     LEFT JOIN memberships mo ON mo.id = i.membership_id
     LEFT JOIN plans p ON p.id = mo.plan_id
     WHERE i.due_date >= date('now','start of month')
     ORDER BY i.due_date DESC LIMIT 100`
  ).all();
  res.json(rows.map((i) => ({
    id: i.id, name: i.member_name, plan: i.plan_name || '—',
    amount: money(i.amount_cents), date: i.due_date, status: i.status, chipStyle: chip(i.status),
  })));
});

router.post('/invoices/:id/retry', (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });
  // No real card processor is wired up - this simulates a retry so the
  // dunning workflow is fully usable end to end without one.
  const succeeds = Math.random() < 0.6;
  db.prepare(
    `UPDATE invoices SET status = ?, attempted_at = datetime('now'), paid_at = ?, retry_count = retry_count + 1 WHERE id = ?`
  ).run(succeeds ? 'paid' : 'failed', succeeds ? new Date().toISOString() : null, invoice.id);
  if (succeeds) {
    db.prepare(`UPDATE members SET status = 'active' WHERE id = ? AND status = 'past_due'`).run(invoice.member_id);
  }
  res.json({ ok: true, succeeded: succeeds });
});

router.post('/invoices/retry-all', (req, res) => {
  const failed = db.prepare(`SELECT * FROM invoices WHERE status = 'failed'`).all();
  let recovered = 0;
  for (const invoice of failed) {
    const succeeds = Math.random() < 0.6;
    db.prepare(
      `UPDATE invoices SET status = ?, attempted_at = datetime('now'), paid_at = ?, retry_count = retry_count + 1 WHERE id = ?`
    ).run(succeeds ? 'paid' : 'failed', succeeds ? new Date().toISOString() : null, invoice.id);
    if (succeeds) {
      recovered++;
      db.prepare(`UPDATE members SET status = 'active' WHERE id = ? AND status = 'past_due'`).run(invoice.member_id);
    }
  }
  res.json({ ok: true, attempted: failed.length, recovered });
});

module.exports = router;
