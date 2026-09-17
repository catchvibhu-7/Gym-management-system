const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');
const { money, initialsOf, monthlyEquivalentCents } = require('../utils');

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
    `SELECT monthly_price_cents amt, billing_period bp FROM memberships WHERE status = 'active'`
  ).all().reduce((sum, r) => sum + monthlyEquivalentCents(r.amt, r.bp), 0);
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
      { label: 'Active members', value: String(memberCount), note: 'Across all billing periods' },
    ],
  });
});

const SORT_COLUMNS = {
  name: 'member_name', plan: 'plan_name', amount: 'i.amount_cents', date: 'i.due_date', status: 'i.status',
};

router.get('/invoices', (req, res) => {
  const { page, limit = 10, sortBy = 'date', sortDir = 'desc' } = req.query;
  const col = SORT_COLUMNS[sortBy] || SORT_COLUMNS.date;
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const allRows = db.prepare(
    `SELECT i.*, m.name member_name, p.name plan_name FROM invoices i
     JOIN members m ON m.id = i.member_id
     LEFT JOIN memberships mo ON mo.id = i.membership_id
     LEFT JOIN plans p ON p.id = mo.plan_id
     WHERE i.due_date >= date('now','start of month')
     ORDER BY ${col} ${dir} NULLS LAST, i.due_date DESC`
  ).all();
  const total = allRows.length;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
  const rows = page ? allRows.slice((pageNum - 1) * lim, (pageNum - 1) * lim + lim) : allRows.slice(0, 100);
  const items = rows.map((i) => ({
    id: i.id, name: i.member_name, plan: i.plan_name || '—',
    amount: money(i.amount_cents), date: i.due_date, status: i.status, chipStyle: chip(i.status),
  }));
  res.json(page ? { items, total } : items);
});

router.get('/invoices/:id', (req, res) => {
  const invoice = db.prepare(
    `SELECT i.*, m.name member_name, p.name plan_name FROM invoices i
     JOIN members m ON m.id = i.member_id
     LEFT JOIN memberships mo ON mo.id = i.membership_id
     LEFT JOIN plans p ON p.id = mo.plan_id
     WHERE i.id = ?`
  ).get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: invoice.id, memberName: invoice.member_name, plan: invoice.plan_name || '—',
    amountCents: invoice.amount_cents, status: invoice.status,
  });
});

// Settling a failed/due invoice is a real payment now, not a simulated
// coin-flip retry - the desk picks cash (settled immediately here) or
// online (the existing invoice-based Razorpay order/verify routes handle
// that, then flip status to 'paid' themselves once the signature checks out).
router.post('/invoices/:id/settle-cash', (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });
  if (invoice.status === 'paid') return res.status(409).json({ error: 'Already paid.' });
  db.prepare(
    `UPDATE invoices SET status = 'paid', attempted_at = datetime('now'), paid_at = datetime('now'), payment_method = 'cash', retry_count = retry_count + 1 WHERE id = ?`
  ).run(invoice.id);
  db.prepare(`UPDATE members SET status = 'active' WHERE id = ? AND status = 'past_due'`).run(invoice.member_id);
  res.json({ ok: true });
});

module.exports = router;
