// Allowlisted static file serving (architecture §7: path traversal control).
// The request path is only used as a key into a fixed map; it is never joined
// to a filesystem path.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sendError } from './http-utils.js';

const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');

const INDEX = {
  file: path.join(PUBLIC_DIR, 'index.html'),
  type: 'text/html; charset=utf-8',
};

const FILES = new Map([
  ['/', INDEX],
  ['/index.html', INDEX],
  ['/app.js', { file: path.join(PUBLIC_DIR, 'app.js'), type: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { file: path.join(PUBLIC_DIR, 'styles.css'), type: 'text/css; charset=utf-8' }],
]);

const ALLOW = 'GET, HEAD';

/** Handles a non-API request. `pathname` is the already-parsed URL pathname. */
export async function handleStatic(req, res, pathname) {
  const entry = FILES.get(pathname);
  if (!entry) {
    sendError(res, 404, 'NOT_FOUND', 'Not found.');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.', { Allow: ALLOW });
    return;
  }

  const body = await readFile(entry.file);
  res.statusCode = 200;
  res.setHeader('Content-Type', entry.type);
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-cache');
  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(body);
  }
}
