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

    if (message.media && message.media.className === 'MessageMediaDocument' && message.media.document) {
      if (!getMediaBySourceId(Number(chatId), message.id)) {
        mediaCount++;
        try {
          await c.sendMessage(config.BOT_USERNAME, {
            forwardMessages: [message.id],
            fromPeer: chatId
          });
          await delay(2000);
        } catch (err) {
          if (err.errorMessage === 'FLOOD_WAIT_X' || err.message.includes('FLOOD_WAIT')) {
            const waitTime = err.seconds || parseInt(err.message.match(/\d+/)?.[0] || '30', 10);
            console.log(`[GRAMJS] Flood wait for ${waitTime} seconds...`);
            await delay(waitTime * 1000);
            try {
              await c.sendMessage(config.BOT_USERNAME, {
                forwardMessages: [message.id],
                fromPeer: chatId
              });
              await delay(2000);
            } catch (retryErr) {
              // Silent skip
            }
          } else {
            // Silent skip for other errors
          }
        }
      }
    }
  }

  console.log(`[GRAMJS] Scan complete: ${total} messages, ${mediaCount} media forwarded`);
  return { total, mediaCount };
}

module.exports = { fetchChannelMedia };
