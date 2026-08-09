const { searchMedia } = require('../database/db');
const { checkRateLimit } = require('../utils/rateLimit');
const config = require('../config');

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

      // Rate limit check — silent ignore on block
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
        const desc = `${file.file_type === 'video' ? '🎬' : '📄'} ${formatSize(file.file_size)}`;
        const base = {
          id:    file.file_unique,
          title: file.file_name,
          description: desc,
          caption: file.caption || undefined,
        };

        if (file.file_type === 'video') {
          return { ...base, type: 'video', video_file_id: file.file_id };
        } else {
          return { ...base, type: 'document', document_file_id: file.file_id };
        }
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
}

module.exports = setupInlineHandler;
