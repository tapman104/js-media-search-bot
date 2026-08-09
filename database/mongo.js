const { MongoClient, ObjectId } = require('mongodb');
const config = require('../config');

let client;
let db;

async function initMongo() {
  if (!client) {
    client = new MongoClient(config.MONGODB_URI);
    await client.connect();
    db = client.db();
    console.log('[MONGO] Connected');

    const files = db.collection('files');
    await files.createIndex({ fileName: 'text' });
    await files.createIndex({ chatId: 1, messageId: 1 }, { unique: true });
  }
  return db;
}

function getMongoDb() {
  if (!db) throw new Error('MongoDB not initialized');
  return db;
}

async function searchMediaMongo(query, offset = 0, limit = 10) {
  query = (query || '').trim();
  const collection = getMongoDb().collection('files');

  if (!query) {
    return await collection.find().sort({ _id: -1 }).skip(offset).limit(limit).toArray();
  }

  // Text search
  let results = await collection.find({ $text: { $search: query } }, { score: { $meta: "textScore" } })
    .sort({ score: { $meta: "textScore" } })
    .skip(offset)
    .limit(limit)
    .toArray();

  // Fallback regex
  if (results.length === 0) {
    const regex = new RegExp(query, 'i');
    results = await collection.find({ fileName: regex })
      .sort({ _id: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
  }

  return results;
}

async function getFileById(id) {
  return await getMongoDb().collection('files').findOne({ _id: new ObjectId(id) });
}

module.exports = { initMongo, getMongoDb, searchMediaMongo, getFileById };
