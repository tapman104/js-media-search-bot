const { Telegraf } = require('telegraf');
const config       = require('./config');
const setupCommands = require('./handlers/commands');
const setupInline   = require('./handlers/inline');
const { setupIndexer } = require('./handlers/indexer');

async function main() {
  console.log('[BOT] Starting Media Search Bot...');

  const bot = new Telegraf(config.BOT_TOKEN);

  // Register handlers
  setupCommands(bot);
  setupInline(bot);
  setupIndexer(bot);

  // Graceful shutdown
  process.once('SIGINT',  () => { console.log('[BOT] SIGINT — stopping'); bot.stop('SIGINT');  });
  process.once('SIGTERM', () => { console.log('[BOT] SIGTERM — stopping'); bot.stop('SIGTERM'); });

  // Error handler — don't crash on individual update errors
  bot.catch((err, ctx) => {
    console.error(`[BOT] Error for update ${ctx.updateType}:`, err.message);
  });

  // Launch with long polling
  await bot.launch({
    dropPendingUpdates: true, // ignore updates that piled up while bot was offline
  });

  const me = await bot.telegram.getMe();
  console.log(`[BOT] Running as @${me.username}`);
  console.log(`[BOT] Indexed channels: ${config.CHANNELS.join(', ') || 'none (add via /addchannel)'}`);
  console.log(`[BOT] Admins: ${config.ADMINS.join(', ')}`);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
