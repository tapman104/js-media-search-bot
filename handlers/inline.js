const { searchMedia, getMediaById } = require('../database/db');
const { checkRateLimit } = require('../utils/rateLimit');
const config = require('../config');
const { forwardFileOnDemand } = require('../userbot');
const { formatSize } = require('../utils/format');

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

      const files = searchMedia(rawQuery, offset, config.MAX_RESULTS);

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
        const desc = `📄 ${formatSize(file.file_size)}`;
        return {
          type: 'article',
          id: file.id.toString(),
          title: file.file_name || 'Unknown File',
          description: desc,
          input_message_content: {
            message_text: `📁 *${file.file_name || 'Unknown File'}*\nSize: ${formatSize(file.file_size)}\n\nClick the button below to download.`,
            parse_mode: 'Markdown'
          },
          reply_markup: {
            inline_keyboard: [[{ text: '📥 Get File', callback_data: `get_${file.id.toString()}` }]]
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
      const file = getMediaById(Number(fileId));
      if (!file) {
        return ctx.answerCbQuery('❌ File not found', { show_alert: true });
      }

      await ctx.answerCbQuery('⏳ Sending file...');
      const targetChat = ctx.callbackQuery?.message?.chat?.id || ctx.from?.id;

      if (targetChat) {
        await forwardFileOnDemand(String(file.chat_id), file.message_id, String(targetChat));
      }
    } catch (err) {
      console.error('[INLINE] Callback Error:', err.message);
      await ctx.answerCbQuery('⚠️ Error sending file', { show_alert: true }).catch(() => {});
    }
  });
}

module.exports = setupInlineHandler;
