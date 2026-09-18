const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');
const { money, initialsOf, monthlyEquivalentCents, periodInfo } = require('../utils');

const router = express.Router();
router.use(requireStaff());

// Paying off a membership-cycle invoice (one with membership_id set - an
// admission/fob-fee/plan-purchase invoice never has this) should roll the
// membership's own due date forward by one billing period, same as any
// real recurring-billing system - nothing did this before, so a member's
// "next charge" date used to just sit there unchanged even after they paid.
// Only rolls forward if this invoice actually covers the CURRENT due date
// (an old already-superseded invoice being paid late shouldn't push a
// since-advanced date out even further).
function advanceMembershipCycle(invoice) {
  if (!invoice.membership_id) return;
  const membership = db.prepare('SELECT * FROM memberships WHERE id = ?').get(invoice.membership_id);
  if (!membership || invoice.due_date < membership.next_charge_date) return;
  db.prepare('UPDATE memberships SET next_charge_date = date(next_charge_date, ?) WHERE id = ?')
    .run(periodInfo(membership.billing_period).dateModifier, membership.id);
}

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
  advanceMembershipCycle(invoice);
  res.json({ ok: true });
});

// "Bill now" from a member's own card: either hands back an invoice that's
// already sitting there unpaid (never double-bills), or - since nothing in
// this app generates the next cycle's invoice automatically - creates one
// for the current due date so there's something to actually collect
// payment against via the normal settle flow (cash here, or Razorpay).
router.post('/members/:id/bill-now', (req, res) => {
  const membership = db.prepare(
    `SELECT * FROM memberships WHERE member_id = ? AND status != 'cancelled' ORDER BY id DESC LIMIT 1`
  ).get(req.params.id);
  if (!membership) return res.status(404).json({ error: 'No membership to bill.' });
  let invoice = db.prepare(
    `SELECT * FROM invoices WHERE membership_id = ? AND status IN ('pending','failed') ORDER BY id DESC LIMIT 1`
  ).get(membership.id);
  if (!invoice) {
    const id = db.prepare(
      `INSERT INTO invoices (member_id, membership_id, amount_cents, due_date, status) VALUES (?,?,?,?, 'pending')`
    ).run(req.params.id, membership.id, membership.monthly_price_cents, membership.next_charge_date).lastInsertRowid;
    invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  }
  res.json({ invoiceId: invoice.id });
});

module.exports = router;
