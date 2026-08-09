const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const config = require('./config');
const { saveMedia, getMediaBySourceId } = require('./database/db');

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

  for await (const message of c.iterMessages(chatId, { limit: undefined, waitTime: 1 })) {
    total++;

    if (message.media && message.media instanceof Api.MessageMediaDocument && message.media.document) {
      mediaCount++;

      const doc = message.media.document;
      const fileName = doc.attributes?.find(a => a.className === 'DocumentAttributeFilename')?.fileName || '';
      const fileSize = Number(doc.size);

      try {
        if (!getMediaBySourceId(Number(chatId), message.id)) {
          saveMedia({
            file_id: doc.id.toString(),
            file_unique: doc.id.toString(),
            file_name: fileName,
            file_size: fileSize,
            file_type: 'document',
            mime_type: doc.mimeType || '',
            caption: message.message || '',
            chat_id: Number(chatId),
            message_id: message.id,
          });
        }
      } catch (err) {
        console.error(`[GRAMJS] Failed to save metadata for ${message.id}:`, err.message);
      }
    }
  }

  console.log(`[GRAMJS] Scan complete: ${total} messages, ${mediaCount} media found`);
  return { total, mediaCount };
}

async function forwardFileOnDemand(chatId, messageId, toPeer) {
  const c = await getClient();
  await c.invoke(new Api.messages.ForwardMessages({
    fromPeer: chatId,
    id: [messageId],
    toPeer: toPeer,
    randomId: [BigInt(Math.floor(Math.random() * 1e13))],
  }));
}

module.exports = { fetchChannelMedia, forwardFileOnDemand };
