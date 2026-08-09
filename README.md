# Media Search Bot

Lightweight Telegram media search bot. SQLite + FTS5, no external DB needed.

## Setup on VPS

```bash
# 1. Upload and enter folder
cd media-search-bot

# 2. Install dependencies
npm install

# 3. Create your .env
cp .env.example .env
nano .env
# Fill in BOT_TOKEN, ADMINS, CHANNELS

# 4. Run once to test
node index.js

# 5. Run with PM2
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

## Commands

| Command | Who | Description |
|---------|-----|-------------|
| /start | Everyone | Welcome message + search button |
| /help | Everyone | Show available commands |
| /addadmin `<id>` | Admin | Add a new admin |
| /removeadmin `<id>` | Admin | Remove an admin |
| /listadmins | Admin | List all admins |
| /addchannel `<id>` [title] | Admin | Add channel/group to index |
| /removechannel `<id>` | Admin | Remove channel from index |
| /listchannels | Admin | List indexed channels |
| /total | Admin | Total indexed files |
| /stats | Admin | Full DB stats |
| /delete `<file_id>` | Admin | Remove file from index |

## How to get a channel/group ID
Forward any message from the channel to @userinfobot — it shows the chat ID.

## Notes
- Bot must be **admin** in channels/groups to see messages
- Indexing is **event-driven only** (no polling, no wasted resources)
- DB lives at `./data/media.db` — backup this file
- Rate limit: 1 search per 10 sec per user (configurable in .env)
