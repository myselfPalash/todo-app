// Application factory shared by server.js and the tests (architecture §4).
// Request pipeline: URL parse -> security headers -> Host check -> route -> catch-all 500.
import http from 'node:http';
import { openDatabase } from './db.js';
import { handleApi } from './api.js';
import { handleStatic } from './static.js';
import {
  ClientAbortedError,
  HttpError,
  applySecurityHeaders,
  canRespond,
  sendError,
} from './http-utils.js';

function formatHostPort(host, port) {
  const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `${h}:${port}`.toLowerCase();
}

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Creates the HTTP server and opens the database.
 * @param {{ dbPath: string, host?: string, port?: number }} options
 * @returns {{ server: http.Server, db: object, listen(): Promise<{host:string,port:number}>,
 *            close(): Promise<void>, address(): import('node:net').AddressInfo|null }}
 */
export function createApp({ dbPath, host = '127.0.0.1', port = 0 } = {}) {
  if (typeof dbPath !== 'string' || dbPath === '') {
    throw new Error('createApp: dbPath is required.');
  }
  const db = openDatabase(dbPath);

  // Built from the bound port after listen() (M-1). Empty until then.
  let allowedHosts = new Set();

  async function handle(req, res) {
    let pathname;
    try {
      // L-2: only the pathname is used; the query string is ignored; no slash normalization.
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      applySecurityHeaders(res, { api: false });
      sendError(res, 400, 'BAD_REQUEST', 'Malformed request URL.');
      return;
    }

    const api = isApiPath(pathname);
    applySecurityHeaders(res, { api });

    const hostHeader = typeof req.headers.host === 'string' ? req.headers.host.toLowerCase() : '';
    if (!allowedHosts.has(hostHeader)) {
      sendError(res, 421, 'MISDIRECTED_REQUEST', 'Host not allowed.');
      return;
    }

    if (api) {
      await handleApi(req, res, pathname, db);
    } else {
      await handleStatic(req, res, pathname);
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (err instanceof ClientAbortedError) {
        return; // nobody to answer
      }
      if (err instanceof HttpError) {
        sendError(res, err.status, err.code, err.message, err.headers);
        return;
      }
      console.error('Unhandled error while processing request:', err);
      if (canRespond(res)) {
        sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error.');
      } else if (!res.destroyed) {
        res.destroy();
      }
    });
  });

  let closePromise = null;

  function listen() {
    return new Promise((resolve, reject) => {
      const onError = (err) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        const addr = server.address();
        const bound = addr.port;
        allowedHosts = new Set([
          formatHostPort('127.0.0.1', bound),
          formatHostPort('localhost', bound),
          formatHostPort('::1', bound),
          formatHostPort(host, bound),
        ]);
        resolve({ host: addr.address, port: bound });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  /** Idempotent shutdown: stop the server, drop keep-alive sockets, then close the DB (M-2). */
  function close() {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      if (server.listening) {
        await new Promise((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
      }
      db.close();
    })();
    return closePromise;
  }

  return {
    server,
    db,
    listen,
    close,
    address: () => server.address(),
  };
}
