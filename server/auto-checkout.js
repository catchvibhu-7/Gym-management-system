const { db } = require('./db');

// Someone who forgets to tap out on the way out (lost fob, distracted,
// device battery died) would otherwise stay "inside" forever, which throws
// off the live inside-now count and the door feed. Anyone still open past
// this long gets auto-checked-out - the checkout time is backdated to
// exactly this cap past their check-in, not "now", so a sweep that runs
// late doesn't inflate how long they were actually recorded as inside.
const AUTO_CHECKOUT_MINUTES = 150; // 2.5 hours
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function runAutoCheckoutSweep() {
  db.prepare(
    `UPDATE checkins
     SET checked_out_at = datetime(checked_in_at, '+${AUTO_CHECKOUT_MINUTES} minutes')
     WHERE checked_out_at IS NULL
       AND checked_in_at <= datetime('now', '-${AUTO_CHECKOUT_MINUTES} minutes')`
  ).run();
}

let sweepTimer = null;
function startAutoCheckoutSchedule() {
  if (sweepTimer) return;
  try { runAutoCheckoutSweep(); } catch (err) { console.error('Auto-checkout sweep failed:', err.message); }
  sweepTimer = setInterval(() => {
    try { runAutoCheckoutSweep(); } catch (err) { console.error('Auto-checkout sweep failed:', err.message); }
  }, SWEEP_INTERVAL_MS);
  if (sweepTimer.unref) sweepTimer.unref();
}

module.exports = { startAutoCheckoutSchedule, runAutoCheckoutSweep, AUTO_CHECKOUT_MINUTES };
