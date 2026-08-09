const {
  isAdmin,
  addAdmin, removeAdmin, listAdmins,
  addChannel, removeChannel, listChannels,
  getTotalCount, deleteMediaByFileId, getStats,
  searchMedia, getMediaById,
} = require('../database/db');
const config = require('../config');
const { runManualIndex } = require('./indexer');
const { fetchChannelMedia } = require('../userbot');
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

  // /start
  bot.start((ctx) => {
    const msg = config.START_MSG.replace(/\\n/g, '\n');
    ctx.reply(msg, {
      reply_markup: {
        inline_keyboard: [[
          { text: '🔍 Search Files', switch_inline_query_current_chat: '' },
        ]],
      },
    });
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
    const parts = ctx.message.text.split(/\s+/);
    const chatIdStr = parts[1];
    let chatId = null;

    if (chatIdStr) {
      chatId = Number(chatIdStr);
      if (isNaN(chatId)) {
        return ctx.reply('Usage: /index [chat_id]\n\nCommits pending media for the specified channel, or all channels if no chat_id is given.');
      }
      
      if (config.SESSION_STRING) {
        await ctx.reply('🔄 Fetching history via GramJS...');
        try {
          const { total, mediaCount } = await fetchChannelMedia(chatId);
          await ctx.reply(`✅ Indexed ${mediaCount} new files from ${chatId} (${total} total messages scanned)`);
          await ctx.reply('✅ GramJS fetch complete. Committing to index...');
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
            await ctx.reply(`✅ Indexed ${mediaCount} new files from ${ch.chat_id} (${total} total messages scanned)`);
          } catch (err) {
            console.error(`[GRAMJS] Failed for ${ch.chat_id}:`, err.message);
          }
        }
        await ctx.reply('✅ GramJS fetch complete. Committing to index...');
      }
    }
    
    await runManualIndex(bot, ctx, chatId);
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

  // /delete <file_id>
  // Usage: reply to a file and use /delete, or pass file_id directly
  bot.command('delete', (ctx) => adminOnly(ctx, () => {
    const parts = ctx.message.text.split(/\s+/);
    let fileId = parts[1];

    // If replying to a message with media, extract file_id automatically
    const reply = ctx.message.reply_to_message;
    if (!fileId && reply) {
      const media = reply.document || reply.video;
      if (media) fileId = media.file_id;
    }

    if (!fileId) {
      return ctx.reply('Usage: /delete <file_id>\nOr reply to a media message with /delete');
    }

    const deleted = deleteMediaByFileId(fileId);
    ctx.reply(deleted ? '✅ File removed from index.' : '❌ File not found in index.');
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
/index [chat\_id] — commit pending media
/total — total indexed files
/stats — full stats
/delete <file\\_id> — remove from index
(or reply to a media msg with /delete)
    `.trim();

    ctx.reply(isAdm ? `${userHelp}\n\n${adminHelp}` : userHelp, { parse_mode: 'Markdown' });
  });

  bot.command('search', async (ctx) => {
    const query = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!query) return ctx.reply('Usage: /search <filename>');
    const results = searchMedia(query, 0, 10);
    if (!results.length) return ctx.reply('❌ No results found for: ' + query);
    const text = results.map((f, i) => `${i+1}. 📄 ${f.file_name}\n💾 ${formatSize(f.file_size)}`).join('\n\n');
    await ctx.reply(`🔍 Results for "${query}":\n\n` + text, {
      reply_markup: {
        inline_keyboard: results.map(f => ([{
          text: `📥 ${f.file_name.substring(0, 40)}`,
          callback_data: `get_${f.id}`
        }]))
      }
    });
  });
}

module.exports = setupCommands;
