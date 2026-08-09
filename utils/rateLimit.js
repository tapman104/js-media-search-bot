const config = require('../config');

// In-memory map: userId -> last search timestamp (ms)
// Lightweight — resets on bot restart, which is fine
const lastSearch = new Map();

// Cleanup old entries every 5 minutes to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - config.RATE_LIMIT_SECONDS * 1000 * 2;
  for (const [uid, ts] of lastSearch) {
    if (ts < cutoff) lastSearch.delete(uid);
  }
}, 5 * 60 * 1000);

/**
 * Returns true if the user is allowed to search now.
 * Updates their timestamp on allow.
 */
function checkRateLimit(userId) {
  const now = Date.now();
  const last = lastSearch.get(userId) || 0;
  const diff = (now - last) / 1000;

  if (diff < config.RATE_LIMIT_SECONDS) {
    return false; // blocked
  }

  lastSearch.set(userId, now);
  return true; // allowed
}

module.exports = { checkRateLimit };
