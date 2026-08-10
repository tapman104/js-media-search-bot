const {
  isAdmin,
  addAdmin, removeAdmin, listAdmins,
  addChannel, removeChannel, listChannels,
  getTotalCount, deleteMediaById, getStats,
  searchMedia, getMediaById, cleanDatabase
} = require('../database/db');
const config = require('../config');
const { formatSize } = require('../utils/format');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function adminOnly(ctx, fn) {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('⛔ Admins only.');
  }
  return fn();
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

// ─── SETUP ───────────────────────────────────────────────────────────────────

function setupCommands(bot) {

  async function sendMediaToUser(ctx, recordId) {
    const record = getMediaById(recordId);
    if (!record) {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('❌ File not found in database.', { show_alert: true }).catch(() => {});
      } else {
        await ctx.reply('❌ File not found in database.');
      }
      return;
    }

    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => {});
      }

      // If requested from a group/DM, ctx.chat.id will exist. 
      // Fallback to ctx.from.id for inline queries where ctx.chat might be undefined.
      const targetChatId = ctx.chat?.id || ctx.from.id;
      const sent = await ctx.telegram.copyMessage(targetChatId, record.chat_id, record.message_id);

      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(targetChatId, sent.message_id);
        } catch (e) {
          // message may already be deleted or bot lacks permission, ignore silently
        }
      }, 8 * 60 * 1000);
    } catch (err) {
      console.error('[DELIVERY] Error:', err.message);
      const errMsg = '❌ Failed to send file. Make sure the bot is still in the indexed channel.';
      try {
        await ctx.reply(errMsg);
      } catch (e) {}
    }
  }

  // /start
  bot.start(async (ctx) => {
    if (ctx.startPayload) {
      const match = ctx.startPayload.match(/^(?:get_f_)?(\d+)$/);
      if (match) {
        return sendMediaToUser(ctx, match[1]);
      }
    }
    const msg = config.START_MSG.replace(/\\n/g, '\n');
    ctx.reply(msg, {
      reply_markup: {
        inline_keyboard: [[
          { text: '🔍 Search Files', switch_inline_query_current_chat: '' },
        ]],
      },
    });
  });

  // Text-based file retrieval
  bot.hears(/^\/get(?:_f_|_| )(\d+)$/i, async (ctx) => {
    await sendMediaToUser(ctx, ctx.match[1]);
  });

  // ─── ADMIN MANAGEMENT ──────────────────────────────────────────────────────

  // /addadmin <user_id>
  bot.command('addadmin', (ctx) => adminOnly(ctx, () => {
    const parts = ctx.message.text.split(/\s+/);
    const targetId = Number(parts[1]);
    if (!targetId || isNaN(targetId)) {
      return ctx.reply('Usage: /addadmin <user_id>');
    }
    if (isAdmin(targetId)) {
      return ctx.reply(`User ${targetId} is already an admin.`);
    }
    addAdmin(targetId, ctx.from.id);
    ctx.reply(`✅ User ${targetId} added as admin.`);
  }));

  // /removeadmin <user_id>
  bot.command('removeadmin', (ctx) => adminOnly(ctx, () => {
    const parts = ctx.message.text.split(/\s+/);
    const targetId = Number(parts[1]);
    if (!targetId || isNaN(targetId)) {
      return ctx.reply('Usage: /removeadmin <user_id>');
    }
    if (config.ADMINS.includes(targetId)) {
      return ctx.reply(`❌ Cannot remove env-seeded admin ${targetId}.`);
    }
    removeAdmin(targetId);
    ctx.reply(`✅ Admin ${targetId} removed.`);
  }));

  // /listadmins
  bot.command('listadmins', (ctx) => adminOnly(ctx, () => {
    const admins = listAdmins();
    if (!admins.length) return ctx.reply('No admins found.');
    const lines = admins.map(a =>
      `• ${a.user_id} (added by ${a.added_by || 'env'} on ${a.added_at.slice(0, 10)})`
    );
    ctx.reply(`👑 Admins:\n${lines.join('\n')}`);
  }));

  // ─── CHANNEL MANAGEMENT ────────────────────────────────────────────────────

  // /addchannel <chat_id> [title]
  bot.command('addchannel', (ctx) => adminOnly(ctx, () => {
    const parts = ctx.message.text.split(/\s+/);
    const chatId = Number(parts[1]);
    if (!chatId || isNaN(chatId)) {
      return ctx.reply('Usage: /addchannel <chat_id> [optional title]\n\nGet chat ID by forwarding a message to @userinfobot');
    }
    const title = parts.slice(2).join(' ') || String(chatId);
    addChannel(chatId, title, ctx.from.id);
    ctx.reply(`✅ Channel/group ${chatId} (${title}) added to index list.`);
  }));

  // /removechannel <chat_id>
  bot.command('removechannel', (ctx) => adminOnly(ctx, () => {
    const parts = ctx.message.text.split(/\s+/);
    const chatId = Number(parts[1]);
    if (!chatId || isNaN(chatId)) {
      return ctx.reply('Usage: /removechannel <chat_id>');
    }
    removeChannel(chatId);
    ctx.reply(`✅ Channel ${chatId} removed from index list.\n⚠️ Existing indexed files from this channel are kept in DB.`);
  }));

  // /listchannels
  bot.command('listchannels', (ctx) => adminOnly(ctx, () => {
    const channels = listChannels();
    if (!channels.length) return ctx.reply('No channels indexed yet.');
    const lines = channels.map(c =>
      `• ${c.chat_title} (${c.chat_id}) — since ${c.added_at.slice(0, 10)}`
    );
    ctx.reply(`📡 Indexed channels/groups:\n${lines.join('\n')}`);
  }));

  // ─── MEDIA MANAGEMENT ──────────────────────────────────────────────────────

  // /index [chat_id]
  bot.command('index', (ctx) => adminOnly(ctx, async () => {
    const { fetchChannelMedia } = require('../userbot');
    const parts = ctx.message.text.split(/\s+/);
    const chatIdStr = parts[1];
    let chatId = null;

    if (chatIdStr) {
      chatId = Number(chatIdStr);
      if (isNaN(chatId)) {
        return ctx.reply('Usage: /index [chat_id]\n\nIndexes the specified channel, or all channels if no chat_id is given.');
      }
      
      if (config.SESSION_STRING) {
        await ctx.reply('🔄 Fetching history via GramJS...');
        try {
          const { total, mediaCount } = await fetchChannelMedia(chatId);
          await ctx.reply(`✅ Indexed ${mediaCount} media files from ${chatId} (${total} total messages scanned).`);
        } catch (err) {
          console.error('[GRAMJS]', err);
          await ctx.reply(`⚠️ GramJS fetch failed: ${err.message}`);
        }
      }
    } else {
      if (config.SESSION_STRING) {
        const channels = listChannels();
        await ctx.reply(`🔄 Fetching history via GramJS for ${channels.length} channels...`);
        for (const ch of channels) {
          try {
            const { total, mediaCount } = await fetchChannelMedia(ch.chat_id);
            await ctx.reply(`✅ Indexed ${mediaCount} media files from ${ch.chat_id} (${total} total messages scanned).`);
          } catch (err) {
            console.error(`[GRAMJS] Failed for ${ch.chat_id}:`, err.message);
          }
        }
      }
    }
  }));

  // /total
  bot.command('total', (ctx) => adminOnly(ctx, () => {
    const count = getTotalCount();
    ctx.reply(`📦 Total indexed files: ${count.toLocaleString()}`);
  }));

  // /stats
  bot.command('stats', (ctx) => adminOnly(ctx, () => {
    const s = getStats();
    ctx.reply(
      `📊 *Bot Stats*\n\n` +
      `📦 Total files: ${s.total.toLocaleString()}\n` +
      `📄 Documents: ${s.docs.toLocaleString()}\n` +
      `🎬 Videos: ${s.videos.toLocaleString()}\n` +
      `📡 Channels: ${s.channels}\n` +
      `👑 Admins: ${s.admins}\n` +
      `💾 DB size: ${formatBytes(s.dbSize)}`,
      { parse_mode: 'Markdown' }
    );
  }));

  // /delete <id>
  // Usage: pass id directly
  bot.command('delete', (ctx) => adminOnly(ctx, () => {
    const parts = ctx.message.text.split(/\s+/);
    const fileId = Number(parts[1]);

    if (!fileId || isNaN(fileId)) {
      return ctx.reply('Usage: /delete <id>');
    }

    const deleted = deleteMediaById(fileId);
    ctx.reply(deleted ? '✅ File removed from index.' : '❌ File not found in index.');
  }));

  // /cleandb
  bot.command('cleandb', (ctx) => adminOnly(ctx, () => {
    cleanDatabase();
    ctx.reply('🧹 Database cleaned. All media and pending media have been wiped. Ready for re-indexing.');
  }));

  // ─── HELP ──────────────────────────────────────────────────────────────────

  bot.command('help', (ctx) => {
    const isAdm = isAdmin(ctx.from.id);
    const userHelp = `
🔍 *Media Search Bot*

Use inline mode to search:
\`@botusername filename\`

Results are paginated automatically.
    `.trim();

    const adminHelp = `

👑 *Admin Commands*

*Admin management:*
/addadmin <user\\_id>
/removeadmin <user\\_id>
/listadmins

*Channel/group management:*
/addchannel <chat\\_id> [title]
/removechannel <chat\\_id>
/listchannels

*Media management:*
/index [chat_id] — index channel history
/total — total indexed files
/stats — full stats
/delete <id> — remove from index
    `.trim();

    ctx.reply(isAdm ? `${userHelp}\n\n${adminHelp}` : userHelp, { parse_mode: 'Markdown' });
  });

  bot.command('search', async (ctx) => {
    const query = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!query) return ctx.reply('Usage: /search <filename>');
    const PAGE_SIZE = 10;
    const results = searchMedia(query, 0, PAGE_SIZE);
    if (!results.length) return ctx.reply('❌ No results found for: ' + query);
    
    const buttons = results.map(f => {
      const name = f.file_name || 'Unknown';
      const truncated = name.length > 40 ? name.substring(0, 37) + '...' : name;
      return [{
        text: `${truncated} • ${formatSize(f.file_size)}`,
        callback_data: `get_f_${f.id}_${ctx.from.id}`
      }];
    });

    if (results.length === PAGE_SIZE) {
      buttons.push([{ text: 'PAGE 2 ▶', callback_data: `search_${query}_${PAGE_SIZE}` }]);
    }

    await ctx.reply(`🔍 Results for "${query}" — Page 1:`, {
      reply_markup: { inline_keyboard: buttons }
    });
  });

  bot.action(/^search_(.+)_(\d+)$/, async (ctx) => {
    const query = ctx.match[1];
    const offset = Number(ctx.match[2]);
    const PAGE_SIZE = 10;
    const results = searchMedia(query, offset, PAGE_SIZE);
    if (!results.length) return ctx.answerCbQuery('No more results.', { show_alert: true });
    
    const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
    const buttons = results.map(f => {
      const name = f.file_name || 'Unknown';
      const truncated = name.length > 40 ? name.substring(0, 37) + '...' : name;
      return [{
        text: `${truncated} • ${formatSize(f.file_size)}`,
        callback_data: `get_f_${f.id}_${ctx.from.id}`
      }];
    });

    if (results.length === PAGE_SIZE) {
      buttons.push([{ text: `PAGE ${currentPage + 1} ▶`, callback_data: `search_${query}_${offset + PAGE_SIZE}` }]);
    }
    
    await ctx.answerCbQuery();
    const header = `🔍 Results for "${query}" — Page ${currentPage}:`;
    try {
      await ctx.editMessageText(header, {
        reply_markup: { inline_keyboard: buttons }
      });
    } catch (err) {
      await ctx.reply(header, {
        reply_markup: { inline_keyboard: buttons }
      });
    }
  });

  bot.action(/^get_f_(\d+)(?:_(\d+))?$/, async (ctx) => {
    const recordId = ctx.match[1];
    const initiatorId = ctx.match[2] ? Number(ctx.match[2]) : null;

    if (!initiatorId) {
      return ctx.answerCbQuery("⚠️ This button is outdated. Please search again.", { show_alert: true }).catch(() => {});
    }

    if (ctx.from.id !== initiatorId) {
      return ctx.answerCbQuery("⛔ This file was requested by someone else.", { show_alert: true }).catch(() => {});
    }

    await sendMediaToUser(ctx, recordId);
  });
}

module.exports = setupCommands;
