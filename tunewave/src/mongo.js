const { MongoClient } = require('mongodb');

let client = null;
let db = null;
let connecting = null;
let lastAttempt = 0;

/** Connects lazily and retries at most every 15 seconds. Returns the db or null. */
async function connect() {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  if (connecting) return connecting;
  if (lastAttempt && Date.now() - lastAttempt < 15000) return null;

  lastAttempt = Date.now();
  connecting = (async () => {
    try {
      client = new MongoClient(uri, { serverSelectionTimeoutMS: 4000 });
      await client.connect();
      db = client.db(process.env.MONGODB_DB || 'tunewave');
      await db.collection('chat_logs').createIndex({ createdAt: -1 });
      await db.collection('feedback').createIndex({ messageId: 1 });
      console.log('[mongo] connected');
      return db;
    } catch (e) {
      console.error('[mongo] connection failed:', e.message);
      db = null;
      try { if (client) await client.close(); } catch { /* ignore */ }
      return null;
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

async function ping() {
  const d = await connect();
  if (!d) return { ok: false, configured: Boolean(process.env.MONGODB_URI) };
  try {
    const t = Date.now();
    await d.command({ ping: 1 });
    return { ok: true, configured: true, latencyMs: Date.now() - t };
  } catch (e) {
    db = null;
    return { ok: false, configured: true };
  }
}

/** Inserts a document. Resolves to true/false and never throws. */
async function insert(collection, doc) {
  const d = await connect();
  if (!d) return false;
  try {
    await d.collection(collection).insertOne({ ...doc, createdAt: new Date() });
    return true;
  } catch (e) {
    console.error(`[mongo] insert into ${collection} failed:`, e.message);
    return false;
  }
}

module.exports = { connect, ping, insert };
