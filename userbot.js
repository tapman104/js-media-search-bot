const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const config = require('./config');
const { getMediaBySourceId, saveMedia } = require('./database/db');

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

async function fetchChannelMedia(chatId) {
  const c = await getClient();

  console.log(`[GRAMJS] Scanning chat ${chatId}...`);
  let total = 0, mediaCount = 0;

  for await (const message of c.iterMessages(chatId, { limit: undefined, waitTime: 1 })) {
    total++;

    if (message.media && message.media.className === 'MessageMediaDocument' && message.media.document) {
      if (!getMediaBySourceId(Number(chatId), message.id)) {
        const doc = message.media.document;
        let file_name = 'Unknown';
        let file_type = 'document';
        
        if (doc.attributes) {
          for (const attr of doc.attributes) {
            if (attr.className === 'DocumentAttributeFilename') {
              file_name = attr.fileName;
            } else if (attr.className === 'DocumentAttributeVideo') {
              file_type = 'video';
            }
          }
        }
        
        const file_size = doc.size ? Number(doc.size) : 0;
        const mime_type = doc.mimeType || 'unknown';
        const caption = message.message || null;

        saveMedia({
          file_name,
          file_size,
          file_type,
          mime_type,
          caption,
          chat_id: Number(chatId),
          message_id: message.id
        });
        mediaCount++;
      }
    }
  }

  console.log(`[GRAMJS] Scan complete: ${total} messages scanned, ${mediaCount} media indexed directly`);
  return { total, mediaCount };
}

module.exports = { fetchChannelMedia };
