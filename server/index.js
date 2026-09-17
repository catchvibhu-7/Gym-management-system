const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

require('./db');
const { seed } = require('./seed');
seed();

const { UPLOADS_DIR } = require('./storage');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1d' }));
app.use('/console', express.static(path.join(__dirname, '..', 'public', 'console')));
app.use('/member', express.static(path.join(__dirname, '..', 'public', 'member')));

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

app.get('/', (req, res) => res.redirect('/console/'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const PORT = process.env.PORT || 3300;
const server = app.listen(PORT, () => {
  console.log(`Gym management server running on http://localhost:${PORT}`);
  console.log(`Owner console: http://localhost:${PORT}/console/`);
  console.log(`Member app:    http://localhost:${PORT}/member/`);
});

// Exported so the Electron desktop wrapper (electron/main.js) can embed
// this server in-process and shut it down cleanly on app quit.
module.exports = server;
