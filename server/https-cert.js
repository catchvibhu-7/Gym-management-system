const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const selfsigned = require('selfsigned');
const { DATA_DIR } = require('./db');

// Derived from db.js's DATA_DIR rather than __dirname directly - see that
// file's comment on why a packaged Electron app can't just compute this
// relative to its own (read-only, archived) source location.
const CERT_DIR = path.join(DATA_DIR, 'certs');
const KEY_FILE = path.join(CERT_DIR, 'selfsigned-key.pem');
const CERT_FILE = path.join(CERT_DIR, 'selfsigned-cert.pem');
const META_FILE = path.join(CERT_DIR, 'selfsigned-meta.json');
const VALID_DAYS = 825;

function execFileP(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

// Self-signed HTTPS is what actually makes the kiosk/member-app camera work
// from a phone on the LAN: getUserMedia refuses to run in an insecure
// context (plain http, non-localhost), so without this a LAN IP link has no
// camera at all, full stop - no amount of app code can work around it.
// The cert is cached to disk and reused across restarts (regenerating it
// every boot would force every phone to re-accept the browser warning
// again); it's only regenerated when the set of LAN IPs actually changes or
// the cached one is close to expiring.
async function ensureSelfSignedCert(lanIPs) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const wantedIPs = [...new Set(lanIPs)].sort();
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch (e) { /* none cached yet */ }
  const stillFresh = meta
    && JSON.stringify(meta.ips) === JSON.stringify(wantedIPs)
    && new Date(meta.notAfter).getTime() - Date.now() > 30 * 24 * 3600 * 1000
    && fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE);
  if (stillFresh) {
    return { key: fs.readFileSync(KEY_FILE, 'utf8'), cert: fs.readFileSync(CERT_FILE, 'utf8') };
  }

  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    { type: 7, ip: '::1' },
    ...wantedIPs.map((ip) => ({ type: 7, ip })),
  ];
  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate.getTime() + VALID_DAYS * 24 * 3600 * 1000);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Forge Room Gym (local network)' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  });
  fs.writeFileSync(KEY_FILE, pems.private, { mode: 0o600 });
  fs.writeFileSync(CERT_FILE, pems.cert);
  fs.writeFileSync(META_FILE, JSON.stringify({ ips: wantedIPs, notAfter: notAfterDate.toISOString() }, null, 2));
  return { key: pems.private, cert: pems.cert };
}

// Best-effort only: if the `tailscale` CLI is installed, logged in, and the
// tailnet has HTTPS certificates turned on (Tailscale admin console > DNS),
// this mints a REAL browser-trusted certificate for this device's Tailscale
// name - a phone on the tailnet gets HTTPS with zero warning, unlike the
// self-signed LAN cert above. Anything short of that (CLI missing, not
// logged in, HTTPS not enabled tailnet-wide, or the command just times out)
// is not an error, it just means Tailscale HTTPS isn't available here - a
// null return means "skip it and fall back to the LAN cert."
async function getTailscaleCert() {
  try {
    const { stdout } = await execFileP('tailscale', ['status', '--json'], { timeout: 4000 });
    const status = JSON.parse(stdout);
    const dnsName = status.Self && status.Self.DNSName ? status.Self.DNSName.replace(/\.$/, '') : null;
    if (!dnsName) return null;
    fs.mkdirSync(CERT_DIR, { recursive: true });
    const certFile = path.join(CERT_DIR, 'tailscale-cert.pem');
    const keyFile = path.join(CERT_DIR, 'tailscale-key.pem');
    await execFileP('tailscale', ['cert', '--cert-file', certFile, '--key-file', keyFile, dnsName], { timeout: 15000 });
    return { hostname: dnsName, cert: fs.readFileSync(certFile, 'utf8'), key: fs.readFileSync(keyFile, 'utf8') };
  } catch (e) {
    return null;
  }
}

module.exports = { ensureSelfSignedCert, getTailscaleCert, CERT_FILE };
