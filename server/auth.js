const crypto = require('crypto');
const { db } = require('./db');

const SESSION_DAYS = 30;
const STAFF_COOKIE = 'gym_staff_session';
const MEMBER_COOKIE = 'gym_member_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function expiryDate() {
  const d = new Date();
  d.setDate(d.getDate() + SESSION_DAYS);
  return d.toISOString();
}

function cookieOptions(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: proto === 'https',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

function createStaffSession(res, req, staffId) {
  const token = newToken();
  db.prepare('INSERT INTO staff_sessions (token, staff_id, expires_at) VALUES (?, ?, ?)')
    .run(token, staffId, expiryDate());
  res.cookie(STAFF_COOKIE, token, cookieOptions(req));
}

function createMemberSession(res, req, memberId) {
  const token = newToken();
  db.prepare('INSERT INTO member_sessions (token, member_id, expires_at) VALUES (?, ?, ?)')
    .run(token, memberId, expiryDate());
  res.cookie(MEMBER_COOKIE, token, cookieOptions(req));
}

function destroyStaffSession(req, res) {
  const token = req.cookies[STAFF_COOKIE];
  if (token) db.prepare('DELETE FROM staff_sessions WHERE token = ?').run(token);
  res.clearCookie(STAFF_COOKIE, { path: '/' });
}

function destroyMemberSession(req, res) {
  const token = req.cookies[MEMBER_COOKIE];
  if (token) db.prepare('DELETE FROM member_sessions WHERE token = ?').run(token);
  res.clearCookie(MEMBER_COOKIE, { path: '/' });
}

// 'kiosk' (locked to the door check-in screen) and 'admin' (system-level:
// backups and setup only, no member/billing/staff data) must never be swept
// in by a bare requireStaff() - every pre-existing route file uses that to
// mean "any real staff member with data access". Routes either role does
// need call requireStaff(...ALL_STAFF_ROLES) or list the role explicitly.
const STAFF_ROLES = ['owner', 'manager', 'coach', 'desk'];
const ALL_STAFF_ROLES = [...STAFF_ROLES, 'kiosk', 'admin'];

// 'systemadmin' is a vendor support/debug role, not a real gym staff
// member - it deliberately bypasses every role check below, on every
// route, regardless of what's passed to requireStaff(...). It exists for
// the product team to get into a customer's own local install when asked
// to help debug something, never created by this app's own signup/wizard
// flow (see server/create-systemadmin.js) - and it's a completely ordinary
// row in the staff table otherwise, so it shows up in Team management and
// the owner can deactivate it there like any other account whenever they
// want to revoke that access.
function requireStaff(...roles) {
  return (req, res, next) => {
    const token = req.cookies[STAFF_COOKIE];
    if (!token) return res.status(401).json({ error: 'Not logged in' });
    const row = db.prepare(
      `SELECT s.* FROM staff_sessions ss JOIN staff s ON s.id = ss.staff_id
       WHERE ss.token = ? AND ss.expires_at > datetime('now') AND s.active = 1`
    ).get(token);
    if (!row) return res.status(401).json({ error: 'Session expired' });
    if (row.role === 'systemadmin') { req.staff = row; return next(); }
    const allowed = roles.length ? roles : STAFF_ROLES;
    if (!allowed.includes(row.role)) {
      return res.status(403).json({ error: 'Not allowed for your role' });
    }
    req.staff = row;
    next();
  };
}

function requireMember(req, res, next) {
  const token = req.cookies[MEMBER_COOKIE];
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  const row = db.prepare(
    `SELECT m.* FROM member_sessions ms JOIN members m ON m.id = ms.member_id
     WHERE ms.token = ? AND ms.expires_at > datetime('now')`
  ).get(token);
  if (!row) return res.status(401).json({ error: 'Session expired' });
  req.member = row;
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createStaffSession,
  createMemberSession,
  destroyStaffSession,
  destroyMemberSession,
  requireStaff,
  requireMember,
  STAFF_COOKIE,
  MEMBER_COOKIE,
  STAFF_ROLES,
  ALL_STAFF_ROLES,
};
