const express = require('express');
const { db } = require('../db');
const { requireStaff, ALL_STAFF_ROLES } = require('../auth');
const { initialsOf, daysAgo, todayISO } = require('../utils');

const router = express.Router();

router.get('/inside', requireStaff(...ALL_STAFF_ROLES), (req, res) => {
  const rows = db.prepare(
    `SELECT c.id, c.checked_in_at, COALESCE(m.name, d.name) name FROM checkins c
     LEFT JOIN members m ON m.id = c.member_id
     LEFT JOIN day_passes d ON d.id = c.day_pass_id
     WHERE c.checked_out_at IS NULL AND c.checked_in_at >= datetime('now','-6 hours')
     ORDER BY c.checked_in_at DESC`
  ).all();
  res.json({ count: rows.length, people: rows });
});

router.get('/feed', requireStaff(), (req, res) => {
  const rows = db.prepare(
    `SELECT c.checked_in_at, c.method, COALESCE(m.name, d.name) name FROM checkins c
     LEFT JOIN members m ON m.id = c.member_id
     LEFT JOIN day_passes d ON d.id = c.day_pass_id
     ORDER BY c.checked_in_at DESC LIMIT 20`
  ).all();
  res.json(rows.map((f) => ({
    time: f.checked_in_at.slice(11, 16), name: f.name,
    method: f.method === 'qr' ? 'QR' : f.method === 'fob' ? 'Fob' : 'Manual',
  })));
});

router.get('/traffic', requireStaff(), (req, res) => {
  const rows = db.prepare(
    `SELECT CAST(strftime('%H', checked_in_at) AS INTEGER) hr, COUNT(*) c
     FROM checkins WHERE checked_in_at >= datetime('now','-28 days')
     GROUP BY hr`
  ).all();
  const byHour = new Map(rows.map((r) => [r.hr, r.c]));
  const max = Math.max(1, ...rows.map((r) => r.c));
  const traffic = [];
  for (let h = 6; h <= 20; h++) {
    const count = byHour.get(h) || 0;
    traffic.push({
      hour: `${h}`.padStart(2, '0'),
      barStyle: `width:100%;border-radius:4px 4px 0 0;background:${h === 18 ? '#137a5f' : '#c9cdc4'};height:${Math.max(4, Math.round((count / max) * 100))}%`,
    });
  }
  res.json(traffic);
});

router.get('/access-stats', requireStaff(), (req, res) => {
  const total = db.prepare(`SELECT COUNT(*) c FROM checkins WHERE checked_in_at >= datetime('now','-28 days')`).get().c || 1;
  const byMethod = db.prepare(
    `SELECT method, COUNT(*) c FROM checkins WHERE checked_in_at >= datetime('now','-28 days') GROUP BY method`
  ).all();
  const labels = { qr: 'QR code', fob: 'Fob', manual: 'Manual (desk)' };
  return res.json(Object.keys(labels).map((key) => {
    const row = byMethod.find((r) => r.method === key);
    const c = row ? row.c : 0;
    return { label: labels[key], share: `${Math.round((c / total) * 100)}%`, note: `${c} check-ins / 4 weeks` };
  }));
});

// Purely informational - flags a code that's been used unusually often
// today so staff can watch for sharing, but takes no action on its own
// (doesn't block the code or notify the member).
router.get('/frequent-today', requireStaff(), (req, res) => {
  const THRESHOLD = 3;
  const rows = db.prepare(
    `SELECT m.id, m.name, c.method, COUNT(*) c FROM checkins c
     JOIN members m ON m.id = c.member_id
     WHERE date(c.checked_in_at) = date('now') AND c.method IN ('qr','fob')
     GROUP BY m.id, c.method
     HAVING c >= ?
     ORDER BY c DESC`
  ).all(THRESHOLD);
  res.json(rows.map((r) => ({
    id: r.id, initials: initialsOf(r.name), name: r.name,
    method: r.method === 'qr' ? 'QR' : 'Fob', count: r.c,
  })));
});

router.get('/lapsed', requireStaff(), (req, res) => {
  const rows = db.prepare(
    `SELECT m.id, m.name, (SELECT MAX(checked_in_at) FROM checkins WHERE member_id = m.id) last_visit
     FROM members m WHERE m.status IN ('active','past_due')`
  ).all().filter((m) => !m.last_visit || daysAgo(m.last_visit) >= 14)
    .sort((a, b) => (daysAgo(b.last_visit || '2000-01-01') - daysAgo(a.last_visit || '2000-01-01')))
    .slice(0, 10);
  res.json(rows.map((m) => ({
    id: m.id, initials: initialsOf(m.name), name: m.name,
    days: m.last_visit ? daysAgo(m.last_visit) : 999,
  })));
});

// `reportedMethod` is what actually gets logged on an access_alerts row -
// usually the same as `method`, except NFC taps are still recorded as a
// plain 'fob' checkin (they read the same fob_code, just via a phone's own
// NFC radio instead of a dedicated reader) but should still show up as
// "nfc" in the alert so the owner knows which door/device it came from.
function toggleMemberCheckin(member, method, reportedMethod) {
  const via = reportedMethod || method;
  if (member.status === 'frozen' || member.status === 'cancelled') {
    db.prepare(`INSERT INTO access_alerts (member_id, method, reason) VALUES (?, ?, ?)`)
      .run(member.id, via, member.status === 'frozen' ? 'Membership frozen' : 'Membership cancelled');
    return { error: `Access denied — membership is ${member.status}`, statusCode: 403, denied: true, name: member.name };
  }
  if (member.status === 'trial' && member.trial_ends_at && member.trial_ends_at < todayISO()) {
    db.prepare(`INSERT INTO access_alerts (member_id, method, reason) VALUES (?, ?, ?)`)
      .run(member.id, via, 'Trial ended');
    return { error: 'Trial has ended — see the desk to join a plan.', statusCode: 403, denied: true, name: member.name };
  }
  if (method === 'qr' && member.qr_suspended) {
    return { error: 'This QR code has been suspended — see the desk.', statusCode: 403 };
  }
  if (method === 'fob' && member.fob_suspended) {
    return { error: 'This fob has been suspended — see the desk.', statusCode: 403 };
  }
  const open = db.prepare(
    `SELECT * FROM checkins WHERE member_id = ? AND checked_out_at IS NULL ORDER BY id DESC LIMIT 1`
  ).get(member.id);
  if (open) {
    db.prepare(`UPDATE checkins SET checked_out_at = datetime('now') WHERE id = ?`).run(open.id);
    return { action: 'checked_out', name: member.name, initials: initialsOf(member.name) };
  }
  db.prepare(`INSERT INTO checkins (member_id, method) VALUES (?, ?)`).run(member.id, method);
  const visitsThisMonth = db.prepare(
    `SELECT COUNT(*) c FROM checkins WHERE member_id = ? AND checked_in_at >= date('now','start of month')`
  ).get(member.id).c;
  const plan = db.prepare(
    `SELECT p.name FROM memberships mo JOIN plans p ON p.id = mo.plan_id WHERE mo.member_id = ? AND mo.status != 'cancelled' ORDER BY mo.id DESC LIMIT 1`
  ).get(member.id);
  return {
    action: 'checked_in', name: member.name, initials: initialsOf(member.name),
    plan: plan ? plan.name : (member.status === 'trial' ? 'Trial' : '—'),
    visitNo: visitsThisMonth,
    note: member.status === 'past_due' ? 'Payment on file failed — send them to the desk after their workout.' : 'Have a great session.',
  };
}

router.post('/scan-by-member', requireStaff(...ALL_STAFF_ROLES), (req, res) => {
  const { memberId } = req.body || {};
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  const result = toggleMemberCheckin(member, 'manual');
  if (result.error) return res.status(result.statusCode).json({ error: result.error });
  res.json(result);
});

router.post('/scan', requireStaff(...ALL_STAFF_ROLES), (req, res) => {
  const { code, via } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Code required' });

  const member = db.prepare('SELECT * FROM members WHERE qr_code = ? OR fob_code = ?').get(code, code);
  if (member) {
    const method = code === member.fob_code ? 'fob' : 'qr';
    const result = toggleMemberCheckin(member, method, via);
    if (result.error) return res.status(result.statusCode).json({ error: result.error, denied: result.denied, name: result.name });
    return res.json(result);
  }

  const dayPass = db.prepare(`SELECT * FROM day_passes WHERE qr_code = ? AND remaining_visits > 0`).get(code);
  if (dayPass) {
    db.prepare(`UPDATE day_passes SET remaining_visits = remaining_visits - 1 WHERE id = ?`).run(dayPass.id);
    db.prepare(`INSERT INTO checkins (day_pass_id, method) VALUES (?, 'qr')`).run(dayPass.id);
    return res.json({ action: 'checked_in', name: dayPass.name, initials: initialsOf(dayPass.name), plan: 'Day pass', visitNo: 1, note: 'Welcome in — ask if they want a tour.' });
  }

  return res.status(404).json({ error: 'Code not recognized' });
});

// Denied taps for a real (frozen/cancelled/expired-trial) membership reason
// get logged here so the owner sees them even if nobody was watching the
// kiosk when it happened - see toggleMemberCheckin above.
router.get('/alerts', requireStaff(...ALL_STAFF_ROLES), (req, res) => {
  const rows = db.prepare(
    `SELECT a.id, a.method, a.reason, a.created_at, m.id member_id, m.name member_name
     FROM access_alerts a LEFT JOIN members m ON m.id = a.member_id
     WHERE a.acknowledged = 0 ORDER BY a.id DESC LIMIT 50`
  ).all();
  res.json(rows);
});

router.post('/alerts/:id/ack', requireStaff(...ALL_STAFF_ROLES), (req, res) => {
  db.prepare('UPDATE access_alerts SET acknowledged = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/alerts/ack-all', requireStaff(...ALL_STAFF_ROLES), (req, res) => {
  db.prepare('UPDATE access_alerts SET acknowledged = 1 WHERE acknowledged = 0').run();
  res.json({ ok: true });
});

module.exports = router;
