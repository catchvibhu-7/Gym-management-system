const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

require('./db');
const { seed } = require('./seed');
seed();

const { UPLOADS_DIR } = require('./storage');
const { findAvailablePort, getLanIPs } = require('./net-utils');
const { startBackupSchedule } = require('./backup');

const paymentsRoutes = require('./routes/payments');

const app = express();

// Razorpay's webhook must be verified against the exact raw bytes it
// sent, so it needs express.raw() ahead of the global JSON parser below -
// once express.json() consumes the stream there is nothing left for a
// signature check against the original body.
app.post('/api/payments/razorpay/webhook', express.raw({ type: 'application/json' }), paymentsRoutes.handleRazorpayWebhook);

app.use(express.json());
app.use(cookieParser());

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1d' }));
app.use('/console', express.static(path.join(__dirname, '..', 'public', 'console')));
app.use('/member', express.static(path.join(__dirname, '..', 'public', 'member')));

app.use('/api/payments', paymentsRoutes.router);
app.use('/api/staff', require('./routes/staffAuth'));
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

app.get('/', (req, res) => res.redirect('/console/'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

async function startServer() {
  const desiredPort = parseInt(process.env.PORT, 10) || 3300;
  const port = await findAvailablePort(desiredPort);
  if (port !== desiredPort) {
    console.log(`Port ${desiredPort} was busy — using ${port} instead.`);
  }

  return new Promise((resolve) => {
    const server = app.listen(port, '0.0.0.0', () => {
      const lanIPs = getLanIPs();
      console.log(`Gym management server running on http://localhost:${port}`);
      lanIPs.forEach((ip) => console.log(`  Also reachable on your network at: http://${ip}:${port}`));
      console.log(`Owner console: http://localhost:${port}/console/`);
      console.log(`Member app:    http://localhost:${port}/member/  ${lanIPs[0] ? `(from a phone: http://${lanIPs[0]}:${port}/member/)` : ''}`);
      startBackupSchedule();
      resolve({ app, server, port, lanIPs });
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
