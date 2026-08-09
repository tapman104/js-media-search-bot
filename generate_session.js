require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (q) => new Promise((resolve) => rl.question(q, resolve));

(async () => {
  console.log('Generating GramJS Session String...');
  
  const apiId = Number(process.env.API_ID);
  const apiHash = process.env.API_HASH;

  if (!apiId || !apiHash) {
    console.error('❌ Error: API_ID and API_HASH must be populated in .env');
    process.exit(1);
  }

  const stringSession = new StringSession(''); 

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await question('Please enter your phone number (e.g. +1234567890): '),
    password: async () => await question('Please enter your 2FA password (leave empty if none): '),
    phoneCode: async () => await question('Please enter the OTP code you received on Telegram: '),
    onError: (err) => console.error('GramJS Error:', err),
  });

  console.log('\n✅ Successfully connected!');
  console.log('========================================================================');
  console.log('Copy the following string and paste it into SESSION_STRING in your .env:');
  console.log('========================================================================\n');
  
  console.log(client.session.save());
  
  console.log('\n========================================================================');
  console.log('⚠️  KEEP THIS SECRET! Anyone with this string can control your account.');
  
  await client.disconnect();
  process.exit(0);
})();
