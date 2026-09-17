const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');
const settingsStore = require('../settingsStore');
const razorpay = require('../payments/razorpay');

const router = express.Router();

// Public (no auth): the checkout widget on the billing page needs the
// publishable key id before a staff action even happens. The secret key
// never leaves the server.
router.get('/config', (req, res) => {
  const provider = settingsStore.get('payment_provider');
  if (provider !== 'razorpay') return res.json({ provider: 'none' });
  const keyId = settingsStore.get('razorpay_key_id');
  res.json({ provider: 'razorpay', keyId: keyId || null, ready: !!(keyId && settingsStore.get('razorpay_key_secret')) });
});

router.post('/razorpay/order', requireStaff(), async (req, res) => {
  const keyId = settingsStore.get('razorpay_key_id');
  const keySecret = settingsStore.get('razorpay_key_secret');
  if (!keyId || !keySecret) return res.status(400).json({ error: 'Razorpay is not configured in Settings > Payments yet.' });

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.body?.invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  try {
    const order = await razorpay.createOrder({
      keyId, keySecret,
      amountCents: invoice.amount_cents,
      currencyCode: settingsStore.get('currency_code') || 'INR',
      receipt: `invoice-${invoice.id}`,
    });
    db.prepare('UPDATE invoices SET gateway_order_id = ? WHERE id = ?').run(order.id, invoice.id);
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId });
  } catch (err) {
    // Most likely to fire in this environment: no real Razorpay account
    // exists to call, or the network can't reach api.razorpay.com.
    res.status(502).json({ error: `Could not create a Razorpay order: ${err.message}` });
  }
});

// Ad-hoc variants for a charge that doesn't have an invoice row yet (a new
// member's first charge, a day pass, a PT session): create the order
// against a bare amount, verify the signature the same way, and only then
// let the caller create the actual record with paymentMethod/gatewayPaymentId
// attached - there's never a "pending" day pass/PT session/member sitting
// around waiting on a payment that never completed.
router.post('/razorpay/order-adhoc', requireStaff(), async (req, res) => {
  const keyId = settingsStore.get('razorpay_key_id');
  const keySecret = settingsStore.get('razorpay_key_secret');
  if (!keyId || !keySecret) return res.status(400).json({ error: 'Razorpay is not configured in Settings > Payments yet.' });
  const { amountCents, receipt } = req.body || {};
  if (!amountCents || amountCents <= 0) return res.status(400).json({ error: 'A positive amount is required.' });

  try {
    const order = await razorpay.createOrder({
      keyId, keySecret, amountCents,
      currencyCode: settingsStore.get('currency_code') || 'INR',
      receipt: receipt || `adhoc-${Date.now()}`,
    });
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId });
  } catch (err) {
    res.status(502).json({ error: `Could not create a Razorpay order: ${err.message}` });
  }
});

router.post('/razorpay/verify-adhoc', requireStaff(), (req, res) => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
  const keySecret = settingsStore.get('razorpay_key_secret');
  if (!keySecret) return res.status(400).json({ error: 'Razorpay is not configured.' });
  const valid = razorpay.verifyPaymentSignature({ orderId, paymentId, signature, keySecret });
  if (!valid) return res.status(400).json({ error: 'Payment signature could not be verified.' });
  res.json({ ok: true, paymentId });
});

router.post('/razorpay/verify', requireStaff(), (req, res) => {
  const { invoiceId, razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
  const keySecret = settingsStore.get('razorpay_key_secret');
  if (!keySecret) return res.status(400).json({ error: 'Razorpay is not configured.' });
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice || invoice.gateway_order_id !== orderId) return res.status(400).json({ error: 'Order does not match this invoice.' });

  const valid = razorpay.verifyPaymentSignature({ orderId, paymentId, signature, keySecret });
  if (!valid) return res.status(400).json({ error: 'Payment signature could not be verified.' });

  db.prepare(
    `UPDATE invoices SET status = 'paid', paid_at = datetime('now'), gateway_payment_id = ?, payment_method = 'razorpay' WHERE id = ?`
  ).run(paymentId, invoice.id);
  db.prepare(`UPDATE members SET status = 'active' WHERE id = ? AND status = 'past_due'`).run(invoice.member_id);
  res.json({ ok: true });
});

// Razorpay calls this directly (not from the browser), so it needs the
// raw request body to check the signature - it can't go through
// express.json(), which would consume the stream first and leave nothing
// for a signature check against the exact bytes sent. server/index.js
// mounts this handler with express.raw() ahead of the global JSON parser;
// it is deliberately NOT registered on `router` below (a router mounted
// after express.json() would only ever see the already-parsed body).
function handleRazorpayWebhook(req, res) {
  const webhookSecret = settingsStore.get('razorpay_webhook_secret');
  const signature = req.headers['x-razorpay-signature'];
  if (!webhookSecret || !signature) return res.status(400).end();

  const valid = razorpay.verifyWebhookSignature({ rawBody: req.body, signature, webhookSecret });
  if (!valid) return res.status(400).end();

  let event;
  try { event = JSON.parse(req.body.toString('utf8')); } catch (e) { return res.status(400).end(); }

  if (event.event === 'payment.captured') {
    const payment = event.payload?.payment?.entity;
    if (payment?.order_id) {
      const invoice = db.prepare('SELECT * FROM invoices WHERE gateway_order_id = ?').get(payment.order_id);
      if (invoice && invoice.status !== 'paid') {
        db.prepare(
          `UPDATE invoices SET status = 'paid', paid_at = datetime('now'), gateway_payment_id = ?, payment_method = 'razorpay' WHERE id = ?`
        ).run(payment.id, invoice.id);
        db.prepare(`UPDATE members SET status = 'active' WHERE id = ? AND status = 'past_due'`).run(invoice.member_id);
      }
    }
  }
  res.json({ ok: true });
}

module.exports = { router, handleRazorpayWebhook };
