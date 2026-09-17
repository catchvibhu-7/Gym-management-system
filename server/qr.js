const QRCode = require('qrcode');

// Real, scannable QR (via the `qrcode` npm package) - not a decorative
// pattern. Anything encoded here (a member's qr_code, a day pass's
// qr_code) is the exact string the /api/checkins/scan endpoint expects
// back, so a phone's camera app or a USB barcode-scanner-as-keyboard can
// both drive check-in from the same code.
function qrSvg(text) {
  return QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#141613', light: '#ffffff00' } });
}

function sendQrSvg(res, text) {
  qrSvg(text)
    .then((svg) => { res.type('image/svg+xml').send(svg); })
    .catch((err) => { res.status(500).json({ error: err.message }); });
}

module.exports = { qrSvg, sendQrSvg };
