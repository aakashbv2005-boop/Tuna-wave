const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'logs');
try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }

const stream = fs.createWriteStream(path.join(dir, 'requests.log'), { flags: 'a' });
stream.on('error', () => { /* logging must never crash the app */ });

const recent = [];

/** Logs every request: time, ip, method, url, status and duration. Request bodies are never logged. */
function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    const time = new Date().toISOString();
    const line = `${time} ${req.ip} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`;
    console.log(line);
    stream.write(line + '\n');

    const p = req.originalUrl.split('?')[0];
    if (!p.startsWith('/api/health')) {
      recent.push({ time, method: req.method, path: p, status: res.statusCode, ms });
      if (recent.length > 30) recent.shift();
    }
  });
  next();
}

function recentRequests() {
  return recent.slice(-15).reverse();
}

module.exports = { requestLogger, recentRequests };
