const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const seed = require('./seed');

const file = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'tunewave.db');
fs.mkdirSync(path.dirname(file), { recursive: true });

const db = new Database(file);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS error_codes (
  code TEXT PRIMARY KEY,
  http_status INTEGER NOT NULL,
  name TEXT NOT NULL,
  meaning TEXT NOT NULL,
  how_to_fix TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  genre TEXT,
  color1 TEXT,
  color2 TEXT,
  duration_sec INTEGER NOT NULL DEFAULT 180,
  available INTEGER NOT NULL DEFAULT 1,
  seed INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('form', 'assistant')),
  status TEXT NOT NULL DEFAULT 'open',
  session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function seedIfEmpty() {
  const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

  if (count('faqs') === 0) {
    const ins = db.prepare('INSERT INTO faqs (category, question, answer, keywords) VALUES (?, ?, ?, ?)');
    db.transaction(() => seed.faqs.forEach((f) => ins.run(f.category, f.question, f.answer, f.keywords)))();
  }
  if (count('error_codes') === 0) {
    const ins = db.prepare('INSERT INTO error_codes (code, http_status, name, meaning, how_to_fix) VALUES (?, ?, ?, ?, ?)');
    db.transaction(() => seed.errorCodes.forEach((c) => ins.run(c.code, c.http_status, c.name, c.meaning, c.how_to_fix)))();
  }
  if (count('tracks') === 0) {
    const ins = db.prepare('INSERT INTO tracks (title, artist, album, genre, color1, color2, duration_sec, available, seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    db.transaction(() => seed.tracks.forEach((t) => ins.run(t.title, t.artist, t.album, t.genre, t.c1, t.c2, t.dur, t.ok, t.seed)))();
  }
}
seedIfEmpty();

const ticketRef = (id) => `TKT-${String(id).padStart(5, '0')}`;

// All queries use bound parameters (?) so user input can never change the SQL.
module.exports = {
  ticketRef,
  listFaqs: () => db.prepare('SELECT id, category, question, answer, keywords FROM faqs ORDER BY id').all(),
  listErrorCodes: () => db.prepare('SELECT code, http_status, name, meaning, how_to_fix FROM error_codes ORDER BY http_status, code').all(),
  getErrorCode: (code) => db.prepare('SELECT code, http_status, name, meaning, how_to_fix FROM error_codes WHERE code = ?').get(code),
  getTrack: (id) => db.prepare('SELECT * FROM tracks WHERE id = ?').get(id),
  searchLocalTracks: (term, limit = 12) => {
    if (!term) return db.prepare('SELECT * FROM tracks ORDER BY id LIMIT ?').all(limit);
    const like = `%${term.replace(/[%_]/g, '')}%`;
    return db.prepare(
      'SELECT * FROM tracks WHERE title LIKE ? OR artist LIKE ? OR genre LIKE ? OR album LIKE ? ORDER BY id LIMIT ?'
    ).all(like, like, like, like, limit);
  },
  createTicket: ({ name, email, subject, message, source, sessionId }) => {
    const info = db.prepare(
      'INSERT INTO tickets (name, email, subject, message, source, session_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name || null, email || null, subject, message, source, sessionId || null);
    const id = Number(info.lastInsertRowid);
    return { id, reference: ticketRef(id) };
  },
  listTickets: (limit = 50) => db.prepare(
    'SELECT id, name, email, subject, message, source, status, created_at FROM tickets ORDER BY id DESC LIMIT ?'
  ).all(limit).map((t) => ({ ...t, reference: ticketRef(t.id) })),
  ping: () => {
    const t = Date.now();
    try {
      db.prepare('SELECT 1').get();
      return { ok: true, latencyMs: Date.now() - t };
    } catch {
      return { ok: false };
    }
  },
};
