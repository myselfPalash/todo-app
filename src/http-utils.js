// HTTP helpers: JSON responses, error responses, security headers and a
// size/content-type limited JSON body reader (architecture §5, §7; M-3).

export const BODY_LIMIT = 4096;

export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; " +
  "connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

/** An error that maps to a specific HTTP error response. */
export class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

/** The client went away before the body was complete; no response should be written. */
export class ClientAbortedError extends Error {
  constructor(message = 'Client aborted the request.') {
    super(message);
    this.name = 'ClientAbortedError';
  }
}

/** True when a response can still be written. */
export function canRespond(res) {
  return !res.headersSent && !res.writableEnded && !res.destroyed;
}

/** Security headers for every response; API responses are never cached. No CORS headers. */
export function applySecurityHeaders(res, { api = false } = {}) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (api) {
    res.setHeader('Cache-Control', 'no-store');
  }
}

/** Sends a JSON body with an explicit length. */
export function sendJson(res, status, obj, headers = {}) {
  if (!canRespond(res)) return;
  const body = JSON.stringify(obj);
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.statusCode = status;
  res.end(body);
}

/** Sends `{ error: { code, message } }`. Never includes stacks or SQL text. */
export function sendError(res, status, code, message, headers = {}) {
  sendJson(res, status, { error: { code, message } }, headers);
}

/** Sends a 204/empty response. */
export function sendEmpty(res, status = 204, headers = {}) {
  if (!canRespond(res)) return;
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  res.statusCode = status;
  res.end();
}

function isJsonContentType(header) {
  if (typeof header !== 'string') return false;
  const mediaType = header.split(';', 1)[0].trim().toLowerCase();
  return mediaType === 'application/json';
}

function tooLarge(limit) {
  // Connection: close so a half-read connection is never reused (M-3).
  return new HttpError(
    413,
    'PAYLOAD_TOO_LARGE',
    `Request body must be at most ${limit} bytes.`,
    { Connection: 'close' }
  );
}

/**
 * Reads and parses a JSON request body (M-3).
 * - 415 when the media type is not application/json (checked before reading).
 * - 413 when Content-Length is over the limit (checked before reading) or when the
 *   streamed body goes over the limit (further chunks are discarded, not buffered).
 * - 400 INVALID_JSON when the body is not valid JSON.
 * - Rejects with ClientAbortedError if the client disconnects or the stream errors.
 * The promise settles exactly once.
 */
export function readJsonBody(req, { limit = BODY_LIMIT } = {}) {
  if (!isJsonContentType(req.headers['content-type'])) {
    return Promise.reject(
      new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
    );
  }

  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) {
    return Promise.reject(tooLarge(limit));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    let overLimit = false;
    const chunks = [];

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    req.on('data', (chunk) => {
      if (overLimit) return; // discard
      size += chunk.length;
      if (size > limit) {
        overLimit = true;
        chunks.length = 0;
        settle(reject, tooLarge(limit));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (overLimit) return;
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        settle(resolve, JSON.parse(text));
      } catch {
        settle(reject, new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON.'));
      }
    });

    req.on('error', () => {
      settle(reject, new ClientAbortedError());
    });

    req.on('close', () => {
      if (!req.complete) {
        settle(reject, new ClientAbortedError());
      }
    });
  });
}
