// A minimal in-memory sliding-window limiter for login endpoints. This app
// runs as a single Node process (no clustering, no shared cache), so an
// in-memory Map is the right amount of infrastructure - reaching for Redis
// or a DB table here would be solving a scaling problem this app doesn't
// have. Not persisted across restarts, which is fine: a restart is rare
// enough that "the counter resets" isn't a meaningful bypass.
const attempts = new Map(); // key -> { count, resetAt }

function checkRateLimit(key, { maxAttempts = 8, windowMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) return true;
  return entry.count < maxAttempts;
}

function recordFailedAttempt(key, { windowMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    entry.count += 1;
  }
}

function clearRateLimit(key) {
  attempts.delete(key);
}

// Prevents unbounded growth on a long-running process - expired entries
// are harmless (checkRateLimit already ignores them) but there's no reason
// to keep them around.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now > entry.resetAt) attempts.delete(key);
  }
}, 10 * 60 * 1000).unref();

module.exports = { checkRateLimit, recordFailedAttempt, clearRateLimit };
