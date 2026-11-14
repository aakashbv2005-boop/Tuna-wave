const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');

/** An error we raised on purpose, with an HTTP status and a public error code. */
class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = String(code || status);
    this.isAppError = true;
  }
}

function wantsJson(req) {
  if (req.originalUrl.startsWith('/api')) return true;
  return req.accepts(['html', 'json']) === 'json';
}

function sendPage(res, status, file, fallbackText) {
  res.status(status).sendFile(file, { root: PUBLIC }, (err) => {
    if (err && !res.headersSent) res.type('text/plain').send(fallbackText);
  });
}

function notFound(req, res, next) {
  next(new AppError(404, '404', 'The page you requested does not exist.'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  let status = 500;
  let code = '500';
  let message = 'Something went wrong on our side. Please try again.';

  if (err.isAppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    if (status >= 500) console.error(`[error] ${status} ${code}: ${message}`);
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = '400';
    message = 'The request body is not valid JSON.';
  } else if (err.type === 'entity.too.large') {
    status = 400;
    code = '400';
    message = 'The request body is too large.';
  } else {
    console.error('[error]', err);
  }

  if (wantsJson(req)) {
    return res.status(status).json({
      error: { status, code, message, help: `/errors#code-${code}` },
    });
  }
  if (status === 404) return sendPage(res, 404, '404.html', '404 - Page not found');
  if (status >= 500) return sendPage(res, status, '500.html', `${status} - Server error`);
  return res.status(status).type('text/plain').send(`${status} - ${message}`);
}

module.exports = { AppError, errorHandler, notFound };
