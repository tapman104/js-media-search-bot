const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const config = require('./config');
const { getMediaBySourceId } = require('./database/db');

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

const fs = require('fs');
const path = require('path');

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function fetchChannelMedia(chatId) {
  const c = await getClient();

  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const stateFile = path.join(dataDir, `pending_forwards_${chatId}.json`);
  let pendingIds = [];

  console.log(`[GRAMJS] Scanning chat ${chatId}...`);
  let total = 0, mediaCount = 0;

  for await (const message of c.iterMessages(chatId, { limit: undefined, waitTime: 1 })) {
    total++;

    if (message.media && message.media.className === 'MessageMediaDocument' && message.media.document) {
      if (!getMediaBySourceId(Number(chatId), message.id)) {
        mediaCount++;
        pendingIds.push(message.id);
      }
    }
  }

  fs.writeFileSync(stateFile, JSON.stringify({ pending: pendingIds }, null, 2));

  console.log(`[GRAMJS] Scan complete: ${total} messages scanned, ${mediaCount} media found to forward`);
  return { total, mediaCount, stateFile };
}

module.exports = { fetchChannelMedia };
