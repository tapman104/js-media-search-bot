const { TelegramClient } = require('telegram');
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

  for await (const message of c.iterMessages(chatId, { limit: undefined })) {
    if (!message.media) continue;

    if (message.document || message.video) {
      try {
        await c.sendMessage(config.BOT_USERNAME, {
          forwardMessages: [message.id],
          fromPeer: chatId,
        });
        await delay(100);
      } catch (err) {
        console.error(`[GRAMJS] Failed to forward message ${message.id} from ${chatId}:`, err.message);
      }
    }
  }
}

module.exports = { fetchChannelMedia };
