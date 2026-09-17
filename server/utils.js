const crypto = require('crypto');

function money(cents) {
  const { currencySymbol } = require('./settingsStore');
  return `${currencySymbol()}${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
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

const BILLING_PERIODS = {
  monthly: { months: 1, label: 'Monthly', dateModifier: '+1 month' },
  quarterly: { months: 3, label: 'Quarterly (3 months)', dateModifier: '+3 months' },
  half_yearly: { months: 6, label: 'Half-yearly (6 months)', dateModifier: '+6 months' },
  yearly: { months: 12, label: 'Yearly', dateModifier: '+1 year' },
};

function periodInfo(period) {
  return BILLING_PERIODS[period] || BILLING_PERIODS.monthly;
}

// Normalizes any billing period's price to a monthly-equivalent figure,
// so MRR (monthly recurring revenue) stays a meaningful single number even
// when plans bill quarterly/half-yearly/yearly.
function monthlyEquivalentCents(priceCents, period) {
  return Math.round(priceCents / periodInfo(period).months);
}

module.exports = {
  money, initialsOf, newCode, todayISO, daysAgo, addDays, BILLING_PERIODS, periodInfo, monthlyEquivalentCents,
};
