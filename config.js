require('dotenv').config();

function parseIds(envVal = '') {
  return envVal.trim().split(/\s+/).filter(Boolean).map(id => {
    const n = Number(id);
    return isNaN(n) ? id : n;
  });
}

const config = {
  BOT_TOKEN:          process.env.BOT_TOKEN,
  BOT_USERNAME:       process.env.BOT_USERNAME,
  API_ID:             process.env.API_ID,
  API_HASH:           process.env.API_HASH,
  SESSION_STRING:     process.env.SESSION_STRING,
  ADMINS:             parseIds(process.env.ADMINS),
  CHANNELS:           parseIds(process.env.CHANNELS),
  RATE_LIMIT_SECONDS: Number(process.env.RATE_LIMIT_SECONDS) || 10,
  MAX_RESULTS:        Number(process.env.MAX_RESULTS) || 10,
  START_MSG:          process.env.START_MSG || 'Hi! Use inline mode to search media.',
  DB_PATH:            process.env.DB_PATH || './data/media.db',
};

if (!config.BOT_TOKEN) {
  console.error('[FATAL] BOT_TOKEN is not set in .env');
  process.exit(1);
}

module.exports = config;
