const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Ensure data directory exists
const dbDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(config.DB_PATH);

// Performance pragmas — safe for single-process bot
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// ─── SCHEMA ─────────────────────────────────────────────────────────────────

db.exec(`
  -- Admins table (seed from env on first run)
  CREATE TABLE IF NOT EXISTS admins (
    user_id   INTEGER PRIMARY KEY,
    added_by  INTEGER,
    added_at  TEXT DEFAULT (datetime('now'))
  );

  -- Indexed channels/groups
  CREATE TABLE IF NOT EXISTS channels (
    chat_id    INTEGER PRIMARY KEY,
    chat_title TEXT,
    added_by   INTEGER,
    added_at   TEXT DEFAULT (datetime('now'))
  );

  -- Media index (main table)
  CREATE TABLE IF NOT EXISTS media (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id     TEXT UNIQUE NOT NULL,
    file_unique TEXT UNIQUE NOT NULL,
    file_name   TEXT NOT NULL,
    file_size   INTEGER,
    file_type   TEXT NOT NULL,   -- 'document' | 'video'
    mime_type   TEXT,
    caption     TEXT,
    chat_id     INTEGER,
    message_id  INTEGER,
    indexed_at  TEXT DEFAULT (datetime('now'))
  );

  -- Pending media (silent accumulator)
  CREATE TABLE IF NOT EXISTS pending_media (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id     TEXT UNIQUE NOT NULL,
    file_unique TEXT UNIQUE NOT NULL,
    file_name   TEXT NOT NULL,
    file_size   INTEGER,
    file_type   TEXT NOT NULL,
    mime_type   TEXT,
    caption     TEXT,
    chat_id     INTEGER,
    message_id  INTEGER,
    added_at    TEXT DEFAULT (datetime('now'))
  );

  -- FTS5 virtual table for fast full-text search on file_name + caption
  CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
    file_name,
    caption,
    content='media',
    content_rowid='id',
    tokenize='unicode61'
  );

  -- Keep FTS in sync with media table
  CREATE TRIGGER IF NOT EXISTS media_ai AFTER INSERT ON media BEGIN
    INSERT INTO media_fts(rowid, file_name, caption)
    VALUES (new.id, new.file_name, COALESCE(new.caption, ''));
  END;

  CREATE TRIGGER IF NOT EXISTS media_ad AFTER DELETE ON media BEGIN
    INSERT INTO media_fts(media_fts, rowid, file_name, caption)
    VALUES ('delete', old.id, old.file_name, COALESCE(old.caption, ''));
  END;

  CREATE TRIGGER IF NOT EXISTS media_au AFTER UPDATE ON media BEGIN
    INSERT INTO media_fts(media_fts, rowid, file_name, caption)
    VALUES ('delete', old.id, old.file_name, COALESCE(old.caption, ''));
    INSERT INTO media_fts(rowid, file_name, caption)
    VALUES (new.id, new.file_name, COALESCE(new.caption, ''));
  END;
`);

// ─── SEED ADMINS FROM ENV ────────────────────────────────────────────────────

const insertAdminStmt = db.prepare(`
  INSERT OR IGNORE INTO admins (user_id, added_by) VALUES (?, 0)
`);
const seedAdmins = db.transaction((admins) => {
  for (const id of admins) insertAdminStmt.run(id);
});
seedAdmins(config.ADMINS);

// Seed channels from env
const insertChanStmt = db.prepare(`
  INSERT OR IGNORE INTO channels (chat_id, chat_title, added_by)
  VALUES (?, '[from env]', 0)
`);
const seedChannels = db.transaction((channels) => {
  for (const id of channels) insertChanStmt.run(id);
});
seedChannels(config.CHANNELS);

// ─── ADMIN QUERIES ───────────────────────────────────────────────────────────

function isAdmin(userId) {
  const row = db.prepare('SELECT 1 FROM admins WHERE user_id = ?').get(userId);
  return !!row;
}

function addAdmin(userId, addedBy) {
  db.prepare('INSERT OR IGNORE INTO admins (user_id, added_by) VALUES (?, ?)').run(userId, addedBy);
}

function removeAdmin(userId) {
  db.prepare('DELETE FROM admins WHERE user_id = ?').run(userId);
}

function listAdmins() {
  return db.prepare('SELECT user_id, added_by, added_at FROM admins ORDER BY added_at').all();
}

// ─── CHANNEL QUERIES ─────────────────────────────────────────────────────────

function isIndexedChannel(chatId) {
  const row = db.prepare('SELECT 1 FROM channels WHERE chat_id = ?').get(chatId);
  return !!row;
}

function addChannel(chatId, chatTitle, addedBy) {
  db.prepare(`
    INSERT OR REPLACE INTO channels (chat_id, chat_title, added_by)
    VALUES (?, ?, ?)
  `).run(chatId, chatTitle || String(chatId), addedBy);
}

function removeChannel(chatId) {
  db.prepare('DELETE FROM channels WHERE chat_id = ?').run(chatId);
}

function listChannels() {
  return db.prepare('SELECT chat_id, chat_title, added_at FROM channels ORDER BY added_at').all();
}

// ─── MEDIA QUERIES ───────────────────────────────────────────────────────────

function saveMedia(media) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO media
        (file_id, file_unique, file_name, file_size, file_type, mime_type, caption, chat_id, message_id)
      VALUES
        (@file_id, @file_unique, @file_name, @file_size, @file_type, @mime_type, @caption, @chat_id, @message_id)
    `).run(media);
    return true;
  } catch (err) {
    console.error('[DB] saveMedia error:', err.message);
    return false;
  }
}

function savePendingMedia(media) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO pending_media
        (file_id, file_unique, file_name, file_size, file_type, mime_type, caption, chat_id, message_id)
      VALUES
        (@file_id, @file_unique, @file_name, @file_size, @file_type, @mime_type, @caption, @chat_id, @message_id)
    `).run(media);
    return true;
  } catch (err) {
    console.error('[DB] savePendingMedia error:', err.message);
    return false;
  }
}

function commitPendingMedia(chatId) {
  return db.transaction(() => {
    // Move records to main media table
    const insertResult = db.prepare(`
      INSERT OR IGNORE INTO media
        (file_id, file_unique, file_name, file_size, file_type, mime_type, caption, chat_id, message_id)
      SELECT file_id, file_unique, file_name, file_size, file_type, mime_type, caption, chat_id, message_id
      FROM pending_media
      WHERE chat_id = ?
    `).run(chatId);

    // Delete pending records for this chat
    db.prepare('DELETE FROM pending_media WHERE chat_id = ?').run(chatId);

    return insertResult.changes;
  })();
}

function searchMedia(query, offset = 0, limit = 10) {
  query = (query || '').trim();

  let rows;

  if (!query) {
    // Empty query → return newest files
    rows = db.prepare(`
      SELECT * FROM media ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
  } else {
    // FTS5 search — fast, handles partial words via prefix queries
    const ftsQuery = query.split(/\s+/).map(w => `"${w.replace(/"/g, '')}"`).join(' OR ');
    rows = db.prepare(`
      SELECT m.* FROM media m
      JOIN media_fts f ON m.id = f.rowid
      WHERE media_fts MATCH ?
      ORDER BY rank
      LIMIT ? OFFSET ?
    `).all(ftsQuery, limit, offset);

    // Fallback: if FTS returns nothing, try LIKE for partial matches
    if (rows.length === 0) {
      const likeQ = `%${query}%`;
      rows = db.prepare(`
        SELECT * FROM media
        WHERE file_name LIKE ? OR caption LIKE ?
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `).all(likeQ, likeQ, limit, offset);
    }
  }

  return rows;
}

function getTotalCount() {
  return db.prepare('SELECT COUNT(*) as count FROM media').get().count;
}

function deleteMediaByFileId(fileId) {
  const info = db.prepare('DELETE FROM media WHERE file_id = ?').run(fileId);
  return info.changes > 0;
}

function getStats() {
  const total     = db.prepare('SELECT COUNT(*) as c FROM media').get().c;
  const docs      = db.prepare("SELECT COUNT(*) as c FROM media WHERE file_type='document'").get().c;
  const videos    = db.prepare("SELECT COUNT(*) as c FROM media WHERE file_type='video'").get().c;
  const channels  = db.prepare('SELECT COUNT(*) as c FROM channels').get().c;
  const admins    = db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
  const dbSize    = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get().size;
  return { total, docs, videos, channels, admins, dbSize };
}

module.exports = {
  isAdmin, addAdmin, removeAdmin, listAdmins,
  isIndexedChannel, addChannel, removeChannel, listChannels,
  saveMedia, savePendingMedia, commitPendingMedia, searchMedia, getTotalCount, deleteMediaByFileId, getStats,
};
