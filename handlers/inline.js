const { searchMedia } = require('../database/db');
const { checkRateLimit } = require('../utils/rateLimit');
const config = require('../config');
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
        const caption = `📁 *${file.file_name || 'Unknown File'}*\nSize: ${formatSize(file.file_size)}`;

        return {
          type: 'article',
          id: file.id.toString(),
          title: file.file_name || 'Unknown File',
          description: desc,
          input_message_content: {
            message_text: caption,
            parse_mode: 'Markdown'
          },
          reply_markup: {
            inline_keyboard: [[{
              text: '📥 Get File',
              callback_data: `get_f_${file.id}`
            }]]
          }
        };
      });

      const nextOffset = files.length === config.MAX_RESULTS
        ? String(offset + config.MAX_RESULTS)
        : '';

      if (results.length > 0) {
        console.log('[INLINE] First result object:', JSON.stringify(results[0], null, 2));
      }

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
}

module.exports = setupInlineHandler;
