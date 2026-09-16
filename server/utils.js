const crypto = require('crypto');

function money(cents) {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
}

function initialsOf(name) {
  return name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function newCode(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(dateStr) {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = { money, initialsOf, newCode, todayISO, daysAgo, addDays };
