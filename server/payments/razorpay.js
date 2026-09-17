// Real Razorpay REST integration using plain https (no SDK dependency,
// consistent with this app's zero-unnecessary-deps approach). Every
// function here does what Razorpay's docs describe correctly, but none of
// it has been exercised against a live account - there are no real API
// keys to test with in this environment. Treat it as correct-by-reading,
// not correct-by-running, until someone with a real Razorpay account
// verifies it end to end.
const https = require('https');
const crypto = require('crypto');

function request(method, urlPath, keyId, keySecret, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: 'api.razorpay.com',
        path: urlPath,
        method,
        auth: `${keyId}:${keySecret}`,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch (e) { parsed = { raw: data }; }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(parsed?.error?.description || `Razorpay API error (${res.statusCode})`));
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Razorpay API request timed out')));
    if (payload) req.write(payload);
    req.end();
  });
}

// amountCents is already in the smallest currency unit for most currencies
// (paise for INR, cents for USD) which is exactly what Razorpay's `amount`
// field expects, so no conversion is needed here.
function createOrder({ keyId, keySecret, amountCents, currencyCode, receipt, notes }) {
  return request('POST', '/v1/orders', keyId, keySecret, {
    amount: amountCents,
    currency: currencyCode,
    receipt,
    notes: notes || {},
  });
}

// Verifies the signature Razorpay Checkout returns to the browser after a
// successful payment (HMAC-SHA256 of "order_id|payment_id" with the key
// secret) - this is what proves the payment is genuine and not forged by
// the client before you mark an invoice paid.
function verifyPaymentSignature({ orderId, paymentId, signature, keySecret }) {
  const expected = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return timingSafeEqualHex(expected, signature);
}

// Verifies a webhook payload's X-Razorpay-Signature header (HMAC-SHA256 of
// the raw request body with the webhook secret configured in the Razorpay
// dashboard - a different secret from the API key pair).
function verifyWebhookSignature({ rawBody, signature, webhookSecret }) {
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return timingSafeEqualHex(expected, signature);
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

module.exports = { createOrder, verifyPaymentSignature, verifyWebhookSignature };
