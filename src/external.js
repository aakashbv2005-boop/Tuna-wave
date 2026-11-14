const db = require('./db');

// Third-party API: iTunes Search API (no key needed).
// It has a hard time limit; if it is slow or down we fall back to the offline catalogue in SQL.

const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;
const status = { ok: null, lastLatencyMs: null, lastChecked: null };

const timeoutMs = () => Number(process.env.EXTERNAL_TIMEOUT_MS) || 3000;

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
  } finally {
    clearTimeout(timer);
  }
}

function fromItunes(r) {
  return {
    id: `it-${r.trackId}`,
    title: r.trackName,
    artist: r.artistName,
    album: r.collectionName || '',
    genre: r.primaryGenreName || '',
    artwork: (r.artworkUrl100 || '').replace('100x100', '300x300') || null,
    previewUrl: r.previewUrl,
    duration: Math.round((r.trackTimeMillis || 30000) / 1000),
    source: 'itunes',
  };
}

function fromLocal(t) {
  return {
    id: `tw-${t.id}`,
    localId: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album || '',
    genre: t.genre || '',
    artwork: null,
    color1: t.color1,
    color2: t.color2,
    previewUrl: null,
    duration: t.duration_sec,
    available: Boolean(t.available),
    source: 'local',
  };
}

async function searchTracks(term, limit = 12) {
  const key = `${term.toLowerCase()}|${limit}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return { ...hit.value, cached: true };

  const started = Date.now();
  try {
    const url = new URL('https://itunes.apple.com/search');
    url.search = new URLSearchParams({
      term,
      media: 'music',
      entity: 'song',
      limit: String(limit * 2),
      country: process.env.ITUNES_COUNTRY || 'IN',
    }).toString();

    const res = await fetchWithTimeout(url, timeoutMs());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    status.ok = true;
    status.lastLatencyMs = Date.now() - started;
    status.lastChecked = new Date().toISOString();

    const tracks = (data.results || [])
      .filter((r) => r.trackId && r.trackName && r.previewUrl)
      .slice(0, limit)
      .map(fromItunes);

    const value = { source: 'itunes', tracks };
    cache.set(key, { value, expires: Date.now() + CACHE_MS });
    return value;
  } catch (e) {
    status.ok = false;
    status.lastLatencyMs = Date.now() - started;
    status.lastChecked = new Date().toISOString();
    console.warn(`[external] iTunes unavailable (${e.name === 'AbortError' ? 'timeout' : e.message}); using offline catalogue`);
    return {
      source: 'fallback',
      reason: e.name === 'AbortError' ? 'timeout' : 'unavailable',
      tracks: db.searchLocalTracks(term, limit).map(fromLocal),
    };
  }
}

const getStatus = () => ({ ...status, timeoutMs: timeoutMs() });

module.exports = { searchTracks, getStatus };
