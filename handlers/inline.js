const { searchMediaMongo, getFileById } = require('../database/mongo');
const { checkRateLimit } = require('../utils/rateLimit');
const config = require('../config');
const { forwardFileOnDemand } = require('../userbot');

function formatSize(bytes) {
  if (!bytes) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

function setupInlineHandler(bot) {
  bot.on('inline_query', async (ctx) => {
    try {
      const userId = ctx.from.id;

      if (!checkRateLimit(userId)) {
        await ctx.answerInlineQuery([], {
          cache_time: 0,
          is_personal: true,
          switch_pm_text: '⏳ Please wait before searching again',
          switch_pm_parameter: 'ratelimit',
        });
        return;
      }

      const rawQuery = ctx.inlineQuery.query || '';
      const offset   = parseInt(ctx.inlineQuery.offset) || 0;

      const files = await searchMediaMongo(rawQuery, offset, config.MAX_RESULTS);

      if (files.length === 0) {
        await ctx.answerInlineQuery([], {
          cache_time: 10,
          is_personal: true,
          switch_pm_text: rawQuery ? '❌ No results found' : '🔍 Type to search files',
          switch_pm_parameter: 'search',
        });
        return;
      }

      const results = files.map((file) => {
        const desc = `📄 ${formatSize(file.fileSize)}`;
        return {
          type: 'article',
          id: file._id.toString(),
          title: file.fileName || 'Unknown File',
          description: desc,
          input_message_content: {
            message_text: `📁 *${file.fileName || 'Unknown File'}*\nSize: ${formatSize(file.fileSize)}\n\nClick the button below to download.`,
            parse_mode: 'Markdown'
          },
          reply_markup: {
            inline_keyboard: [[{ text: '📥 Get File', callback_data: `get_${file._id.toString()}` }]]
          }
        };
      });

      const nextOffset = files.length === config.MAX_RESULTS
        ? String(offset + config.MAX_RESULTS)
        : '';

      await ctx.answerInlineQuery(results, {
        cache_time:  5,
        is_personal: true,
        next_offset: nextOffset,
      });
    } catch (err) {
      console.error('[INLINE] Error:', err.message);
      await ctx.answerInlineQuery([], { cache_time: 0 }).catch(() => {});
    }
  });

  bot.action(/^get_(.+)$/, async (ctx) => {
    try {
      const fileId = ctx.match[1];
      const file = await getFileById(fileId);
      if (!file) {
        return ctx.answerCbQuery('❌ File not found', { show_alert: true });
      }

      await ctx.answerCbQuery('⏳ Sending file...');
      const targetChat = ctx.chat?.id || ctx.from?.id; // works in DMs and groups

      if (targetChat) {
        await forwardFileOnDemand(file.chatId, file.messageId, targetChat);
      }
    } catch (err) {
      console.error('[INLINE] Callback Error:', err.message);
      await ctx.answerCbQuery('⚠️ Error sending file', { show_alert: true }).catch(() => {});
    }
  });
}

module.exports = setupInlineHandler;
