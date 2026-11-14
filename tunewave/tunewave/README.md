# TuneWave

A Spotify-style music site with an AI support assistant. Search songs, play instant previews, read the FAQ, and ask the assistant for help. When the assistant cannot answer, it opens a support ticket.

**Live site:** https://YOUR-APP-NAME.onrender.com  <!-- replace with your deployed link before submitting -->

## Proposed improvement

**Ticket tracking with email updates.** Today a ticket is created and stored in SQL, but the person who raised it cannot see its status. A next step is a `/tickets/:reference` page (protected by a per-ticket secret token) showing open, in progress or resolved, plus an email sent when an agent replies. This would close the loop between "the assistant could not answer" and "the problem was fixed".

## Requirements checklist

| Requirement | Where it is |
|---|---|
| Responsive site, 3+ pages, chat widget on every page | `public/*.html` (Home, Discover, FAQ, Support, Error codes, Status, 404, 500). Widget: `public/js/chat.js`, loaded by every page |
| 10+ FAQs in SQL, shown on the FAQ page | 13 rows seeded into the `faqs` table (`src/seed.js`), served by `GET /api/faqs`, rendered in `public/faq.html` |
| 8+ error codes | 400, 401, 403, 404, 429, 500, 503 and the site-specific **TW-701** (track unavailable) in the `error_codes` table. Page: `/errors` |
| Custom 404 and 500 pages with "Ask the assistant" | `public/404.html`, `public/500.html` |
| AI assistant: FAQ answers, error explanations, ticket when it cannot answer | `src/assistant.js` (Claude answers only from the FAQ and error-code tables; a keyword matcher is the fallback) |
| Tickets in SQL; chat logs and feedback in MongoDB | `tickets` table in SQLite; `chat_logs` and `feedback` collections in MongoDB (`src/mongo.js`) |
| Keys in environment variables, nothing secret in Git | `.env` is git-ignored; `.env.example` lists every variable with empty values |
| Request logging | `src/logger.js` writes every request to the console and `logs/requests.log` (bodies are never logged) |
| Health check page | `/health` (page) and `/api/health` (JSON, returns 503 if SQL is down) |
| Third-party API with time limit and fallback | iTunes Search API with a 3 second timeout (`EXTERNAL_TIMEOUT_MS`). On timeout or failure, the offline catalogue from SQL is used and labelled on screen. `src/external.js` |

## Error codes in use

| Code | When the app returns it |
|---|---|
| 400 | Empty or too-long chat message, invalid email, bad track id, malformed JSON |
| 401 | `GET /api/admin/tickets` without a token |
| 403 | `GET /api/admin/tickets` with the wrong token |
| 404 | Unknown page (custom page) or unknown API route (JSON) |
| 429 | More than 20 chat requests or 5 ticket requests per minute from one IP (`Retry-After` is sent) |
| 500 | Unexpected crash (custom page). Demo: `/demo/crash` |
| 503 | SQL failure, feedback storage unavailable, or `ADMIN_TOKEN` not configured |
| TW-701 | Preview requested for an unavailable track (HTTP 422). Try "Ghost Frequency" in offline mode |

On the `/errors` page, **Try it** calls `/api/demo-error/<code>` so each response can be shown live.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
cp .env.example .env      # then fill in the values you have
npm start                 # http://localhost:3000
```

The app works with only the defaults: without `ANTHROPIC_API_KEY` the assistant uses its keyword matcher, and without `MONGODB_URI` chat logging is skipped (the Status page shows MongoDB as "Not configured").

## Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the Claude-powered assistant. Server side only, never sent to the browser |
| `ANTHROPIC_MODEL` | Model name (default `claude-haiku-5-5`) |
| `MONGODB_URI`, `MONGODB_DB` | MongoDB connection (chat logs, feedback). MongoDB Atlas free tier works |
| `SQLITE_PATH` | SQLite file location (default `./data/tunewave.db`) |
| `ADMIN_TOKEN` | Protects `GET /api/admin/tickets` (send as `Authorization: Bearer <token>`) |
| `EXTERNAL_TIMEOUT_MS` | Time limit for the iTunes API (default 3000) |
| `DEMO_ROUTES` | Set to `off` to disable `/demo/crash` and `/api/demo-error/*` |

## Deploy on Render

1. Push this folder to a new GitHub repository. Check that `.env` is **not** in it (`git status` should not list it).
2. In MongoDB Atlas, create a free cluster, a database user, and allow access from anywhere (or Render's IPs). Copy the connection string.
3. On Render choose **New > Web Service**, connect the repository, then set Build Command `npm install` and Start Command `npm start`.
4. Under **Environment**, add `ANTHROPIC_API_KEY`, `MONGODB_URI`, `ADMIN_TOKEN` and `NODE_ENV=production`.
5. Deploy, then paste the live URL at the top of this README and commit.

Note: SQLite is a file. On Render's free tier the disk is wiped on every deploy and restart, so tickets are lost then (FAQs, error codes and tracks are re-created automatically). Attach a persistent disk and set `SQLITE_PATH` to it, or move to a hosted SQL database, for permanent tickets.

## Before you submit

- Open the live site on a phone (or use browser dev tools device mode) and check every page, the menu button, the player and the chat widget.
- Open a wrong address such as `/no-such-page`. The custom 404 page with the "Ask the assistant" button must appear.
- Open `/demo/crash` to confirm the custom 500 page.
- Ask the assistant something unrelated ("what is the capital of France?"). It should create a ticket. Check it with `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://YOUR-APP.onrender.com/api/admin/tickets`.
- Open `/health` and confirm SQL, MongoDB and the AI assistant show as connected.
- Make sure no key, token or password appears anywhere in the repository history.

## Project structure

```
server.js            Express app, routes, rate limiting, admin auth
src/db.js            SQLite schema, seeding, parameterised queries
src/seed.js          FAQs, error codes, offline track catalogue
src/assistant.js     Claude call + keyword fallback + ticket creation
src/mongo.js         MongoDB chat logs and feedback
src/external.js      iTunes API with timeout, cache and fallback
src/logger.js        Request logging
src/errors.js        AppError, 404 and 500 handling
public/              Pages, styles, player and chat widget
```
