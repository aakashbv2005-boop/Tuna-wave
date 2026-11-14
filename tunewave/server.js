require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');

const db = require('./src/db');
const mongo = require('./src/mongo');
const external = require('./src/external');
const assistant = require('./src/assistant');
const { requestLogger, recentRequests } = require('./src/logger');
const { AppError, errorHandler, notFound } = require('./src/errors');

const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;
const startedAt = Date.now();
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // correct client IPs behind Render/Heroku-style proxies

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});
app.use(requestLogger);
app.use(express.json({ limit: '16kb' }));

/* ---------- helpers ---------- */

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Like wrap, but turns unexpected SQL failures into a 503 response. */
const sqlRoute = (fn) => wrap(async (req, res) => {
  try {
    return await fn(req, res);
  } catch (e) {
    if (e.isAppError) throw e;
    console.error('[sql]', e.message);
    throw new AppError(503, '503', 'The database is temporarily unavailable. Please try again soon.');
  }
});

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    let h = hits.get(req.ip);
    if (!h || h.reset < now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(req.ip, h);
    }
    h.count += 1;
    if (h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return next(new AppError(429, '429', 'Too many requests. Please wait a moment and try again.'));
    }
    return next();
  };
}
const chatLimiter = rateLimit({ windowMs: 60_000, max: 20 });
const ticketLimiter = rateLimit({ windowMs: 60_000, max: 5 });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return next(new AppError(503, '503', 'The admin API is disabled because ADMIN_TOKEN is not configured.'));
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.get('x-admin-token');
  if (!token) return next(new AppError(401, '401', 'Authentication required. Send your admin token.'));
  if (!safeEqual(token, expected)) return next(new AppError(403, '403', 'You do not have access to this resource.'));
  return next();
}

/* ---------- API ---------- */

app.get('/api/faqs', sqlRoute((req, res) => {
  res.json({ faqs: db.listFaqs() });
}));

app.get('/api/error-codes', sqlRoute((req, res) => {
  res.json({ codes: db.listErrorCodes() });
}));

app.get('/api/discover/search', wrap(async (req, res) => {
  const q = text(req.query.q, 80) || process.env.DISCOVER_DEFAULT_TERM || 'top hits';
  res.json(await external.searchTracks(q));
}));

app.get('/api/tracks/:id/preview', sqlRoute((req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new AppError(400, '400', 'Track id must be a positive whole number.');
  const track = db.getTrack(id);
  if (!track) throw new AppError(404, '404', 'That track does not exist.');
  if (!track.available) throw new AppError(422, 'TW-701', 'This track is not available for preview right now.');
  res.json({ id: track.id, mode: 'synth', seed: track.seed, durationSec: Math.min(track.duration_sec, 24) });
}));

app.post('/api/chat', chatLimiter, wrap(async (req, res) => {
  const body = req.body || {};
  const message = text(body.message, 501);
  if (!message) throw new AppError(400, '400', 'Please type a message first.');
  if (message.length > 500) throw new AppError(400, '400', 'Messages can be up to 500 characters long.');
  const email = typeof body.email === 'string' && EMAIL_RE.test(body.email.trim()) ? body.email.trim().slice(0, 120) : null;
  const out = await assistant.handleChat({
    message,
    history: Array.isArray(body.history) ? body.history : [],
    sessionId: text(body.sessionId, 64),
    email,
  });
  res.json(out);
}));

app.post('/api/feedback', wrap(async (req, res) => {
  const body = req.body || {};
  const rating = body.rating;
  const messageId = text(body.messageId, 64);
  if (!messageId) throw new AppError(400, '400', 'messageId is required.');
  if (rating !== 'up' && rating !== 'down') throw new AppError(400, '400', 'rating must be "up" or "down".');
  const saved = await mongo.insert('feedback', {
    messageId,
    sessionId: text(body.sessionId, 64) || null,
    rating,
    comment: text(body.comment, 500) || null,
  });
  if (!saved) throw new AppError(503, '503', 'Feedback could not be saved right now. Please try again later.');
  res.status(201).json({ ok: true });
}));

app.post('/api/tickets', ticketLimiter, sqlRoute((req, res) => {
  const body = req.body || {};
  const name = text(body.name, 80);
  const email = text(body.email, 120);
  const subject = text(body.subject, 120);
  const message = text(body.message, 2000);
  if (!EMAIL_RE.test(email)) throw new AppError(400, '400', 'Please enter a valid email address.');
  if (subject.length < 3) throw new AppError(400, '400', 'Please add a subject (at least 3 characters).');
  if (message.length < 10) throw new AppError(400, '400', 'Please describe the problem in at least 10 characters.');
  const ticket = db.createTicket({ name, email, subject, message, source: 'form' });
  res.status(201).json({ reference: ticket.reference });
}));

app.get('/api/admin/tickets', adminAuth, sqlRoute((req, res) => {
  res.json({ tickets: db.listTickets(100) });
}));

app.get('/api/health', wrap(async (req, res) => {
  const sql = db.ping();
  const mg = await mongo.ping();
  const ext = external.getStatus();
  const ai = { configured: Boolean(process.env.ANTHROPIC_API_KEY) };

  let status = 'ok';
  if (!sql.ok) status = 'down';
  else if (!mg.ok || ext.ok === false) status = 'degraded';

  res.status(sql.ok ? 200 : 503).json({
    status,
    time: new Date().toISOString(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    checks: { sql, mongo: mg, externalApi: { name: 'iTunes Search API', ...ext }, ai },
    recentRequests: recentRequests(),
  });
}));

/* ---------- Demo routes (so each error page / code can be shown on purpose) ---------- */

if (process.env.DEMO_ROUTES !== 'off') {
  app.get('/api/demo-error/:code', sqlRoute((req, res, next) => {
    const c = db.getErrorCode(String(req.params.code).toUpperCase());
    if (!c) throw new AppError(404, '404', 'Unknown error code.');
    throw new AppError(c.http_status, c.code, `Demo: ${c.name}`);
  }));
  app.get('/demo/crash', () => {
    throw new Error('Intentional crash to demonstrate the custom 500 page');
  });
}

/* ---------- Static site, 404, errors ---------- */

app.use('/api', (req, res, next) => next(new AppError(404, '404', 'That API route does not exist.')));
app.use(express.static(PUBLIC, {
  extensions: ['html'],
  maxAge: process.env.NODE_ENV === 'production' ? '10m' : 0,
}));
app.use(notFound);
app.use(errorHandler);

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

app.listen(PORT, () => {
  console.log(`TuneWave listening on port ${PORT}`);
  mongo.connect().catch(() => {});
});
