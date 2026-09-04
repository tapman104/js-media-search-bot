const { Telegraf } = require('telegraf');
const config       = require('./config');

const setupCommands = require('./handlers/commands');
const setupInline   = require('./handlers/inline');
const { setupForward } = require('./handlers/forward');
const { listChannels, saveMedia } = require('./database/db');

async function main() {
  console.log('[BOT] Starting Media Search Bot...');
  const bot = new Telegraf(config.BOT_TOKEN);

  // Register handlers
  setupCommands(bot);
  setupInline(bot);
  setupForward(bot);

  // Real-time indexing: only fires for channels where the bot is an admin
  bot.on('channel_post', (ctx) => {
    const doc = ctx.channelPost.document;
    const vid = ctx.channelPost.video;
    if (!doc && !vid) return;

    const channels = listChannels();
    const isIndexed = channels.some(ch => ch.chat_id === ctx.chat.id);
    if (!isIndexed) return;

    const media = doc || vid;
    const file_name = doc ? (doc.file_name || 'Unknown') : (vid.file_name || 'video');
    const file_size = media.file_size || 0;
    const file_type = doc ? 'document' : 'video';
    const mime_type = media.mime_type || 'unknown';
    const caption = ctx.channelPost.caption || '';
    
    saveMedia({
      file_name,
      file_size,
      file_type,
      mime_type,
      caption,
      chat_id: ctx.chat.id,
      message_id: ctx.channelPost.message_id
    });
  });

  // Graceful shutdown
  process.once('SIGINT',  () => { console.log('[BOT] SIGINT — stopping'); bot.stop('SIGINT');  });
  process.once('SIGTERM', () => { console.log('[BOT] SIGTERM — stopping'); bot.stop('SIGTERM'); });

  // Error handler — don't crash on individual update errors
  bot.catch((err, ctx) => {
    console.error(`[BOT] Error for update ${ctx.updateType}:`, err.message);
  });

  const me = await bot.telegram.getMe();
  console.log(`[BOT] Running as @${me.username}`);

  // Launch with long polling
  await bot.launch({
    dropPendingUpdates: true, // ignore updates that piled up while bot was offline
  });
  console.log(`[BOT] Indexed channels: ${config.CHANNELS.join(', ') || 'none (add via /addchannel)'}`);
  console.log(`[BOT] Admins: ${config.ADMINS.join(', ')}`);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
