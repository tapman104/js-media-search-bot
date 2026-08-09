const { isIndexedChannel, savePendingMedia, commitPendingMedia, listChannels } = require('../database/db');

/**
 * Listens for messages in indexed channels and silently accumulates them in the pending table.
 */
function setupIndexer(bot) {
  bot.on(['message', 'channel_post'], async (ctx) => {
    try {
      console.log('[INDEXER] Received message from:', ctx.from?.id, 'type:', ctx.message?.document ? 'document' : 'other');
      const msg = ctx.message || ctx.channelPost;
      if (!msg) return;

      let chatId = ctx.chat.id;
      let originalMessageId = msg.message_id;

      // Check if the message is forwarded from a channel
      if (msg.forward_from_chat) {
        chatId = msg.forward_from_chat.id;
        originalMessageId = msg.forward_from_message_id || msg.message_id;
      } else if (msg.forward_origin && msg.forward_origin.chat) {
        chatId = msg.forward_origin.chat.id;
        originalMessageId = msg.forward_origin.message_id || msg.message_id;
      }

      if (!isIndexedChannel(chatId)) return;

      let media = null;
      let fileType = null;

      if (msg.document) {
        media = msg.document;
        fileType = 'document';
      } else if (msg.video) {
        media = msg.video;
        fileType = 'video';
      }

      if (!media) return;

      savePendingMedia({
        file_id:     media.file_id,
        file_unique: media.file_unique_id,
        file_name:   media.file_name || media.file_unique_id,
        file_size:   media.file_size || null,
        file_type:   fileType,
        mime_type:   media.mime_type || null,
        caption:     msg.caption || null,
        chat_id:     chatId,
        message_id:  originalMessageId,
      });

    } catch (err) {
      console.error('[INDEXER] Error caching message:', err.message);
    }
  });
}

/**
 * Manually commits all pending media for a specific chat ID, or all channels, into the main index.
 */
async function runManualIndex(bot, ctx, targetChatId) {
  if (targetChatId) {
    const successCount = commitPendingMedia(targetChatId);
    return ctx.reply(`✅ Successfully indexed ${successCount} files for chat ${targetChatId}.`);
  } else {
    const channels = listChannels();
    let total = 0;
    let msg = '✅ Indexed complete:\n';
    
    for (const ch of channels) {
      const count = commitPendingMedia(ch.chat_id);
      if (count > 0) {
        msg += `• ${ch.chat_title} (${ch.chat_id}): ${count} new files\n`;
        total += count;
      }
    }
    
    if (total === 0) {
      return ctx.reply('✅ No new pending media found in any indexed channel.');
    }
    
    msg += `• Total: ${total} new files`;
    return ctx.reply(msg);
  }
}

module.exports = { setupIndexer, runManualIndex };
