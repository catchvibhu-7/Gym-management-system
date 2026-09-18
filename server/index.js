const path = require('path');
const https = require('https');
const tls = require('tls');
const express = require('express');
const cookieParser = require('cookie-parser');

require('./db');
const { seed } = require('./seed');
seed();

const { UPLOADS_DIR } = require('./storage');
const { findAvailablePort, getLanIPs } = require('./net-utils');
const { startBackupSchedule } = require('./backup');
const { startAutoCheckoutSchedule } = require('./auto-checkout');
const { ensureSelfSignedCert, getTailscaleCert } = require('./https-cert');
const runtimeInfo = require('./runtime-info');

const paymentsRoutes = require('./routes/payments');

const app = express();

// Razorpay's webhook must be verified against the exact raw bytes it
// sent, so it needs express.raw() ahead of the global JSON parser below -
// once express.json() consumes the stream there is nothing left for a
// signature check against the original body.
app.post('/api/payments/razorpay/webhook', express.raw({ type: 'application/json' }), paymentsRoutes.handleRazorpayWebhook);

// Default 100kb is plenty for every other JSON body this app sends, but a
// favicon upload (POST /api/settings/favicon) arrives as a base64 data URL
// - inflates a small image well past that default, so it's raised globally
// rather than juggling a second per-route parser after this one has already
// rejected an oversized body.
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1d' }));
app.use('/console', express.static(path.join(__dirname, '..', 'public', 'console')));
app.use('/member', express.static(path.join(__dirname, '..', 'public', 'member')));

app.use('/api/payments', paymentsRoutes.router);
app.use('/api/staff', require('./routes/staffAuth'));
app.use('/api/setup', require('./routes/setup'));
app.use('/api/member-auth', require('./routes/memberAuth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/members', require('./routes/members'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/checkins', require('./routes/checkins'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/team', require('./routes/staffTeam'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/automations', require('./routes/automations'));
app.use('/api/workout-plans', require('./routes/workoutPlans'));
app.use('/api/member', require('./routes/memberApp'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/system', require('./routes/system'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/kiosk', require('./routes/kiosk'));
app.use('/api/facilities', require('./routes/facilities'));
app.use('/api/staff-attendance', require('./routes/staffAttendance'));
app.use('/api/pt-sessions', require('./routes/ptSessions'));

app.get('/', (req, res) => res.redirect('/console/'));
// A memorable, bookmarkable URL for a shared front-desk device - the
// #kiosk hash is what app.js's showApp() checks to log straight into
// kiosk mode instead of the normal console after signing in.
app.get('/kiosk', (req, res) => res.redirect('/console/#kiosk'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// A phone's browser refuses to expose the camera (getUserMedia) on a plain
// http:// LAN address at all - it's not a "secure context", full stop, no
// app code can talk it out of that. This starts a second, HTTPS listener
// next to the normal http one so the kiosk/member app actually has a
// camera-capable URL to hand a phone. It tries a real Tailscale-issued
// certificate first (zero browser warning, but only for the Tailscale
// hostname, and only if the CLI/tailnet support it) and always falls back
// to a self-signed one covering every LAN IP (works everywhere, but shows
// a one-time "connection not private" warning to click through).
async function startHttpsServer(httpPort, lanIPs) {
  const desiredHttpsPort = parseInt(process.env.HTTPS_PORT, 10) || httpPort + 1;
  let httpsPort;
  try {
    httpsPort = await findAvailablePort(desiredHttpsPort);
  } catch (err) {
    console.warn('Could not find a free HTTPS port - camera access from other devices will be unavailable:', err.message);
    return { httpsServer: null, httpsPort: null, tailscaleHostname: null };
  }

  const selfSigned = await ensureSelfSignedCert(lanIPs);
  const tsCert = await getTailscaleCert();
  const tsSecureContext = tsCert ? tls.createSecureContext({ key: tsCert.key, cert: tsCert.cert }) : null;

  return new Promise((resolve) => {
    const httpsServer = https.createServer({
      key: selfSigned.key,
      cert: selfSigned.cert,
      // A request by IP never carries SNI (only hostname-based requests
      // do), so this only ever kicks in for the Tailscale MagicDNS name -
      // any LAN-IP connection transparently gets the self-signed default.
      SNICallback: (servername, cb) => {
        if (tsSecureContext && tsCert && servername === tsCert.hostname) cb(null, tsSecureContext);
        else cb(null, null);
      },
    }, app);
    httpsServer.on('error', (err) => {
      console.warn(`HTTPS server failed to start on port ${httpsPort} - camera access from other devices will be unavailable:`, err.message);
      resolve({ httpsServer: null, httpsPort: null, tailscaleHostname: tsCert ? tsCert.hostname : null });
    });
    httpsServer.listen(httpsPort, '0.0.0.0', () => {
      resolve({ httpsServer, httpsPort, tailscaleHostname: tsCert ? tsCert.hostname : null });
    });
  });
}

async function startServer() {
  const desiredPort = parseInt(process.env.PORT, 10) || 3300;
  const port = await findAvailablePort(desiredPort);
  if (port !== desiredPort) {
    console.log(`Port ${desiredPort} was busy — using ${port} instead.`);
  }

  return new Promise((resolve) => {
    const server = app.listen(port, '0.0.0.0', async () => {
      const lanIPs = getLanIPs();
      console.log(`Gym management server running on http://localhost:${port}`);
      lanIPs.forEach((ip) => console.log(`  Also reachable on your network at: http://${ip}:${port}`));
      console.log(`Owner console: http://localhost:${port}/console/`);
      console.log(`Member app:    http://localhost:${port}/member/  ${lanIPs[0] ? `(from a phone: http://${lanIPs[0]}:${port}/member/)` : ''}`);

      const { httpsServer, httpsPort, tailscaleHostname } = await startHttpsServer(port, lanIPs);
      runtimeInfo.port = port;
      runtimeInfo.httpsPort = httpsPort;
      runtimeInfo.tailscaleHostname = tailscaleHostname;
      if (httpsPort) {
        console.log(`Camera-capable HTTPS also available (self-signed - your browser will warn once):`);
        lanIPs.forEach((ip) => console.log(`  https://${ip}:${httpsPort}`));
        if (tailscaleHostname) console.log(`  https://${tailscaleHostname}:${httpsPort}  (trusted Tailscale cert - no warning)`);
      }

      startBackupSchedule();
      startAutoCheckoutSchedule();
      resolve({ app, server, httpsServer, port, httpsPort, lanIPs });
    });
  });
}

// `node server/index.js` (npm start / npm run dev) starts immediately.
// electron/main.js instead requires this module and calls startServer()
// itself so it can learn the resolved port before opening its window.
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
