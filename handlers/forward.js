const { getClient } = require('../userbot');
const { adminOnly } = require('../utils/auth');

const activeJobs = new Set(); // key: `${sourceChatId}->${destChatId}`
const BATCH_DELAY_MS = 2000;
const BATCH_SIZE = 100;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function setupForward(bot) {
  bot.command('forward', (ctx) => adminOnly(ctx, async () => {
    const parts = ctx.message.text.split(/\s+/);
    if (parts.length < 3) {
      return ctx.reply('Usage: /forward <source_chat_id> <dest_chat_id> [start_msg_id]');
    }
    
    const sourceChatId = parseInt(parts[1], 10);
    const destChatId = parseInt(parts[2], 10);
    const startMsgId = parts[3] ? parseInt(parts[3], 10) : 0;
    
    if (isNaN(sourceChatId) || isNaN(destChatId) || isNaN(startMsgId)) {
      return ctx.reply('Error: Chat IDs and start_msg_id must be integers.');
    }
    
    const jobKey = `${sourceChatId}->${destChatId}`;
    if (activeJobs.has(jobKey)) {
      return ctx.reply('⚠️ A forward job for this pair is already running. Use /stopforward to cancel.');
    }
    
    ctx.reply(`⏳ Bulk forward started: ${sourceChatId} → ${destChatId}`);
    runForward(ctx, sourceChatId, destChatId, startMsgId);
  }));

  bot.command('stopforward', (ctx) => adminOnly(ctx, () => {
    const parts = ctx.message.text.split(/\s+/);
    if (parts.length < 3) {
      return ctx.reply('Usage: /stopforward <source_chat_id> <dest_chat_id>');
    }
    const sourceChatId = parseInt(parts[1], 10);
    const destChatId = parseInt(parts[2], 10);
    if (isNaN(sourceChatId) || isNaN(destChatId)) {
      return ctx.reply('Error: Chat IDs must be integers.');
    }
    
    const jobKey = `${sourceChatId}->${destChatId}`;
    if (activeJobs.has(jobKey)) {
      activeJobs.delete(jobKey);
      ctx.reply('🛑 Forward job stopped.');
    } else {
      ctx.reply('No active job found for that pair.');
    }
  }));
}

async function runForward(ctx, sourceChatId, destChatId, startMsgId) {
  const jobKey = `${sourceChatId}->${destChatId}`;
  activeJobs.add(jobKey);
  
  let statusMsg;
  try {
    const client = await getClient();
    if (!client || !client.connected) {
      if (ctx.chat) {
        await ctx.telegram.sendMessage(ctx.chat.id, "❌ Userbot not running. Set API_ID/API_HASH/SESSION_STRING.");
      }
      return;
    }
    
    if (ctx.chat) {
      statusMsg = await ctx.telegram.sendMessage(ctx.chat.id, "📦 Forwarding...");
    }
    
    let offsetId = startMsgId || 0;
    let total = 0;
    let running = true;
    let lastUpdateTotal = 0;
    
    while (running && activeJobs.has(jobKey)) {
      const messages = await client.getMessages(sourceChatId, { limit: BATCH_SIZE, offsetId, addOffset: 0, reverse: true });
      if (!messages || messages.length === 0) {
        break;
      }
      
      for (const message of messages) {
        if (!activeJobs.has(jobKey)) {
          running = false;
          break;
        }
        
        try {
          await client.forwardMessages(destChatId, { messages: [message.id], fromPeer: sourceChatId });
          total++;
        } catch (err) {
          if (err.name === 'FloodWaitError' || err.errorMessage === 'FLOOD_WAIT') {
            await sleep((err.seconds + 2) * 1000);
            try {
              await client.forwardMessages(destChatId, { messages: [message.id], fromPeer: sourceChatId });
              total++;
            } catch (retryErr) {
              console.error(`Skipped message ${message.id} after retry: ${retryErr.message}`);
            }
          } else {
            console.error(`Skipped message ${message.id}: ${err.message}`);
          }
        }
      }
      
      offsetId = messages[messages.length - 1].id;
      
      if (total - lastUpdateTotal >= 50 && running && statusMsg) {
        try {
          await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `📦 Forwarded ${total} messages...`);
          lastUpdateTotal = total;
        } catch (e) {}
      }
      
      await sleep(BATCH_DELAY_MS);
    }
    
    if (statusMsg) {
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `✅ Done. Forwarded ${total} messages from ${sourceChatId} → ${destChatId}`);
      } catch (e) {}
    }
  } catch (err) {
    if (statusMsg) {
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `❌ Forward failed: ${err.message}`);
      } catch (e) {}
    } else {
      if (ctx.chat) {
        await ctx.telegram.sendMessage(ctx.chat.id, '❌ Forward failed: ' + err.message);
      }
    }
  } finally {
    activeJobs.delete(jobKey);
  }
}

module.exports = { setupForward };
