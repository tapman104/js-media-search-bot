const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const config = require('./config');

const apiId = Number(config.API_ID);
const apiHash = config.API_HASH;
const stringSession = new StringSession(config.SESSION_STRING || '');

let client = null;

async function getClient() {
  if (!client) {
    client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });
    await client.connect();
  }
  return client;
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function fetchChannelMedia(chatId) {
  const c = await getClient();
  
  if (!config.BOT_USERNAME) {
    throw new Error('BOT_USERNAME is not configured in .env');
  }

  console.log(`[GRAMJS] Scanning chat ${chatId}...`);
  let total = 0, mediaCount = 0;

  for await (const message of c.iterMessages(chatId, { limit: undefined })) {
    total++;

    if (!message.media) continue;
    if (!(message.media instanceof Api.MessageMediaDocument)) continue;
    if (!message.media.document) continue;

    mediaCount++;


    const forwardMessage = async () => {
      await c.sendMessage(config.BOT_USERNAME, {
        forwardMessages: [message.id],
        fromPeer: chatId,
      });
      console.log(`[GRAMJS] Successfully forwarded message ${message.id} from ${chatId}`);
      await delay(500);
    };

    try {
      await forwardMessage();
    } catch (err) {
      if (err.name === 'FloodWaitError' || err.errorMessage?.startsWith('FLOOD_WAIT')) {
        const seconds = err.seconds || parseInt(err.errorMessage?.split('_')[2]) || 5;
        console.log(`[GRAMJS] FloodWait triggered. Sleeping for ${seconds} seconds before retrying...`);
        await delay(seconds * 1000 + 1000);
        
        try {
          await forwardMessage();
        } catch (retryErr) {
          // If retry fails, log and move on
          console.error(`[GRAMJS] Retry failed for message ${message.id} from ${chatId}:`, retryErr.message);
        }
      } else {
        // Not a FloodWait, log it but don't crash
        console.error(`[GRAMJS] Failed to forward message ${message.id} from ${chatId}:`, err.message);
      }
    }
  }

  console.log(`[GRAMJS] Scan complete: ${total} messages, ${mediaCount} media found`);
}

module.exports = { fetchChannelMedia };
