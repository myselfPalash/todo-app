// HTTP integration tests for the REST API and static serving (T3).
// AC1–AC5, error mapping, M-1 (bound-port Host allowlist), M-3 (body limits / aborts), L-2, L-4.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; " +
  "connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

/** Raw request via node:http (lets the test set Host, stream chunks, or abort). */
function rawRequest(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('API and static integration', { timeout: 30000 }, () => {
  let app;
  let base;
  let port;

  async function api(method, path, { json, body, headers = {} } = {}) {
    const init = { method, headers: { ...headers } };
    if (json !== undefined) {
      init.body = JSON.stringify(json);
      init.headers['Content-Type'] ??= 'application/json';
    } else if (body !== undefined) {
      init.body = body;
    }
    const res = await fetch(`${base}${path}`, init);
    const text = await res.text();
    let data = null;
    if (text !== '' && (res.headers.get('content-type') ?? '').startsWith('application/json')) {
      data = JSON.parse(text);
    }
    return { status: res.status, headers: res.headers, text, data };
  }

  before(async () => {
    app = createApp({ dbPath: ':memory:', port: 0 });
    ({ port } = await app.listen());
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await app.close();
  });

  describe('AC1 add task', () => {
    it('creates a trimmed, pending task with 201 and Location', async () => {
      const r = await api('POST', '/api/tasks', { json: { description: '  Buy milk  ' } });
      assert.equal(r.status, 201);
      assert.equal(r.data.description, 'Buy milk');
      assert.equal(r.data.completed, false);
      assert.equal(typeof r.data.id, 'number');
      assert.equal(r.headers.get('location'), `/api/tasks/${r.data.id}`);
      assert.match(r.headers.get('content-type'), /^application\/json; charset=utf-8$/);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal(r.headers.get('content-security-policy'), CSP);
    });

    for (const [name, description] of [
      ['empty', ''],
      ['whitespace-only', '   \t  '],
      ['201 characters', 'a'.repeat(201)],
    ]) {
      it(`rejects ${name} description with 400 VALIDATION_ERROR`, async () => {
        const r = await api('POST', '/api/tasks', { json: { description } });
        assert.equal(r.status, 400);
        assert.equal(r.data.error.code, 'VALIDATION_ERROR');
        assert.equal(typeof r.data.error.message, 'string');
      });
    }

    it('accepts exactly 200 characters', async () => {
      const r = await api('POST', '/api/tasks', { json: { description: 'b'.repeat(200) } });
      assert.equal(r.status, 201);
      await api('DELETE', `/api/tasks/${r.data.id}`);
    });
  });

  describe('AC2 list tasks', () => {
    it('returns all created tasks in creation order', async () => {
      const created = [];
      for (const d of ['first', 'second', 'third']) {
        created.push((await api('POST', '/api/tasks', { json: { description: d } })).data);
      }
      const r = await api('GET', '/api/tasks');
      assert.equal(r.status, 200);
      assert.ok(Array.isArray(r.data.tasks));
      const ids = r.data.tasks.map((t) => t.id);
      assert.deepEqual([...ids].sort((a, b) => a - b), ids, 'ordered by id ASC');
      for (const t of created) {
        assert.deepEqual(r.data.tasks.find((x) => x.id === t.id), t);
      }
      const tail = r.data.tasks.slice(-3).map((t) => t.description);
      assert.deepEqual(tail, ['first', 'second', 'third']);
    });

    it('ignores the query string (L-2)', async () => {
      const r = await api('GET', '/api/tasks?x=1');
      assert.equal(r.status, 200);
      assert.ok(Array.isArray(r.data.tasks));
    });
  });

  describe('AC3 toggle status', () => {
    it('marks complete and pending again, persisted', async () => {
      const { data: t } = await api('POST', '/api/tasks', { json: { description: 'toggle me' } });
      let r = await api('PATCH', `/api/tasks/${t.id}`, { json: { completed: true } });
      assert.equal(r.status, 200);
      assert.equal(r.data.completed, true);
      assert.equal((await api('GET', `/api/tasks/${t.id}`)).data.completed, true);

      r = await api('PATCH', `/api/tasks/${t.id}`, { json: { completed: false } });
      assert.equal(r.status, 200);
      assert.equal(r.data.completed, false);
      const list = (await api('GET', '/api/tasks')).data.tasks;
      assert.equal(list.find((x) => x.id === t.id).completed, false);
    });

    it('returns 404 for an unknown ID', async () => {
      const r = await api('PATCH', '/api/tasks/999999', { json: { completed: true } });
      assert.equal(r.status, 404);
      assert.equal(r.data.error.code, 'NOT_FOUND');
    });
  });

  describe('AC4 edit description', () => {
    it('updates the description and keeps updatedAt', async () => {
      const { data: t } = await api('POST', '/api/tasks', { json: { description: 'old text' } });
      const r = await api('PATCH', `/api/tasks/${t.id}`, { json: { description: '  new text ' } });
      assert.equal(r.status, 200);
      assert.equal(r.data.description, 'new text');
      assert.equal(typeof r.data.updatedAt, 'string');
      assert.ok(r.data.updatedAt >= t.createdAt);
      assert.equal((await api('GET', `/api/tasks/${t.id}`)).data.description, 'new text');
    });

    it('rejects an empty edit with 400 and keeps the old text', async () => {
      const { data: t } = await api('POST', '/api/tasks', { json: { description: 'keep me' } });
      const r = await api('PATCH', `/api/tasks/${t.id}`, { json: { description: '   ' } });
      assert.equal(r.status, 400);
      assert.equal(r.data.error.code, 'VALIDATION_ERROR');
      assert.equal((await api('GET', `/api/tasks/${t.id}`)).data.description, 'keep me');
    });

    it('rejects an empty PATCH body {} with 400', async () => {
      const { data: t } = await api('POST', '/api/tasks', { json: { description: 'x' } });
      const r = await api('PATCH', `/api/tasks/${t.id}`, { json: {} });
      assert.equal(r.status, 400);
    });
  });

  describe('AC5 delete task', () => {
    it('deletes with 204 and an empty body; second delete is 404', async () => {
      const { data: t } = await api('POST', '/api/tasks', { json: { description: 'delete me' } });
      const r = await api('DELETE', `/api/tasks/${t.id}`);
      assert.equal(r.status, 204);
      assert.equal(r.text, '');
      const list = (await api('GET', '/api/tasks')).data.tasks;
      assert.equal(list.some((x) => x.id === t.id), false);
      const again = await api('DELETE', `/api/tasks/${t.id}`);
      assert.equal(again.status, 404);
      assert.equal(again.data.error.code, 'NOT_FOUND');
    });
  });

  describe('single task and IDs', () => {
    it('GET /api/tasks/{id} returns 200 for a known ID', async () => {
      const { data: t } = await api('POST', '/api/tasks', { json: { description: 'one' } });
      const r = await api('GET', `/api/tasks/${t.id}`);
      assert.equal(r.status, 200);
      assert.deepEqual(r.data, t);
    });

    for (const id of ['999999', '0', 'abc', '01', '-1', '1.5', '12345678901234567']) {
      it(`GET /api/tasks/${id} → 404`, async () => {
        const r = await api('GET', `/api/tasks/${id}`);
        assert.equal(r.status, 404);
        assert.equal(r.data.error.code, 'NOT_FOUND');
      });
    }
  });

  describe('request validation', () => {
    it('invalid JSON → 400 INVALID_JSON', async () => {
      const r = await api('POST', '/api/tasks', {
        body: '{"description": ',
        headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(r.status, 400);
      assert.equal(r.data.error.code, 'INVALID_JSON');
      assert.doesNotMatch(r.text, /\bat \S+:\d+/);
    });

    it('array body → 400', async () => {
      const r = await api('POST', '/api/tasks', { json: [{ description: 'x' }] });
      assert.equal(r.status, 400);
      assert.equal(r.data.error.code, 'VALIDATION_ERROR');
    });

    it('unknown field → 400', async () => {
      const r = await api('POST', '/api/tasks', { json: { description: 'x', id: 5 } });
      assert.equal(r.status, 400);
      assert.equal(r.data.error.code, 'VALIDATION_ERROR');
    });

    it('completed:"true" → 400', async () => {
      const { data: t } = await api('POST', '/api/tasks', { json: { description: 'x' } });
      const r = await api('PATCH', `/api/tasks/${t.id}`, { json: { completed: 'true' } });
      assert.equal(r.status, 400);
      assert.equal(r.data.error.code, 'VALIDATION_ERROR');
    });

    it('text/plain → 415 and nothing is created', async () => {
      const before = (await api('GET', '/api/tasks')).data.tasks.length;
      const r = await api('POST', '/api/tasks', {
        body: JSON.stringify({ description: 'x' }),
        headers: { 'Content-Type': 'text/plain' },
      });
      assert.equal(r.status, 415);
      assert.equal(r.data.error.code, 'UNSUPPORTED_MEDIA_TYPE');
      assert.equal((await api('GET', '/api/tasks')).data.tasks.length, before);
    });

    it('application/json; charset=utf-8 is accepted', async () => {
      const r = await api('POST', '/api/tasks', {
        body: JSON.stringify({ description: 'charset ok' }),
        headers: { 'Content-Type': 'Application/JSON; charset=utf-8' },
      });
      assert.equal(r.status, 201);
    });
  });

  describe('routing', () => {
    it('PUT /api/tasks → 405 with Allow: GET, POST', async () => {
      const r = await api('PUT', '/api/tasks', { json: { description: 'x' } });
      assert.equal(r.status, 405);
      assert.equal(r.headers.get('allow'), 'GET, POST');
    });

    it('POST /api/tasks/1 → 405 with Allow: GET, PATCH, DELETE', async () => {
      const r = await api('POST', '/api/tasks/1', { json: { description: 'x' } });
      assert.equal(r.status, 405);
      assert.equal(r.headers.get('allow'), 'GET, PATCH, DELETE');
    });

    it('unknown /api/nope → 404', async () => {
      const r = await api('GET', '/api/nope');
      assert.equal(r.status, 404);
      assert.equal(r.data.error.code, 'NOT_FOUND');
    });

    it('trailing slash /api/tasks/ → 404 (L-2)', async () => {
      const r = await api('GET', '/api/tasks/');
      assert.equal(r.status, 404);
    });
  });

  describe('body limits and stream edge cases (M-3)', () => {
    it('5 KiB body with Content-Length → 413 + Connection: close; server still answers', async () => {
      const body = JSON.stringify({ description: 'x'.repeat(5 * 1024) });
      const r = await rawRequest(port, {
        method: 'POST',
        path: '/api/tasks',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        body,
      });
      assert.equal(r.status, 413);
      assert.equal(r.headers.connection, 'close');
      assert.equal(JSON.parse(r.body).error.code, 'PAYLOAD_TOO_LARGE');
      assert.equal((await api('GET', '/api/tasks')).status, 200);
    });

    it('~64 KiB chunked body (no Content-Length) → 413 + Connection: close; server still answers', async () => {
      const r = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: '/api/tasks',
            agent: false,
            headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
          },
          (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () =>
              resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })
            );
          }
        );
        // The server may close the socket while we are still writing; that is expected.
        req.on('error', (err) => {
          if (!req.res) reject(err);
        });
        assert.equal(req.getHeader('content-length'), undefined);
        req.write('{"description":"');
        for (let i = 0; i < 64; i++) req.write('y'.repeat(1024));
        req.end('"}');
      });
      assert.equal(r.status, 413);
      assert.equal(r.headers.connection, 'close');
      assert.equal(JSON.parse(r.body).error.code, 'PAYLOAD_TOO_LARGE');
      assert.equal((await api('GET', '/api/tasks')).status, 200);
    });

    it('a client that aborts mid-body does not crash the server', async () => {
      await new Promise((resolve) => {
        const req = http.request({
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/api/tasks',
          agent: false,
          headers: { 'Content-Type': 'application/json', 'Content-Length': 100 },
        });
        req.on('error', () => resolve());
        req.on('close', () => resolve());
        req.write('{"description":"par');
        setTimeout(() => req.destroy(), 50);
      });
      await new Promise((r) => setTimeout(r, 50));
      const r = await api('GET', '/api/tasks');
      assert.equal(r.status, 200);
    });
  });

  describe('Host allowlist (M-1)', () => {
    it('default fetch Host (127.0.0.1:{ephemeral port}) is accepted', async () => {
      // Every request above already used it; check once explicitly.
      const r = await api('GET', '/api/tasks');
      assert.equal(r.status, 200);
    });

    it('Host: LOCALHOST:{port} is accepted (case-insensitive)', async () => {
      const r = await rawRequest(port, { path: '/api/tasks', headers: { Host: `LOCALHOST:${port}` } });
      assert.equal(r.status, 200);
    });

    it('Host: evil.example → 421', async () => {
      const r = await rawRequest(port, { path: '/api/tasks', headers: { Host: 'evil.example' } });
      assert.equal(r.status, 421);
      assert.equal(JSON.parse(r.body).error.code, 'MISDIRECTED_REQUEST');
    });
  });

  describe('static files', () => {
    it('GET / → 200 text/html', async () => {
      const r = await api('GET', '/');
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /^text\/html/);
      assert.match(r.text, /<!DOCTYPE html>/i);
      assert.equal(r.headers.get('content-security-policy'), CSP);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(r.headers.get('access-control-allow-origin'), null);
    });

    it('GET /index.html → 200 text/html', async () => {
      const r = await api('GET', '/index.html');
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /^text\/html/);
    });

    it('GET /app.js → 200 text/javascript', async () => {
      const r = await api('GET', '/app.js');
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /^text\/javascript/);
    });

    it('GET /styles.css → 200 text/css', async () => {
      const r = await api('GET', '/styles.css');
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /^text\/css/);
    });

    it('HEAD / → 200 with an empty body', async () => {
      const r = await api('HEAD', '/');
      assert.equal(r.status, 200);
      assert.equal(r.text, '');
      assert.match(r.headers.get('content-type'), /^text\/html/);
    });

    it('GET /?x=1 → 200 (query ignored)', async () => {
      const r = await api('GET', '/?x=1');
      assert.equal(r.status, 200);
    });

    it('POST / → 405 with Allow: GET, HEAD', async () => {
      const r = await api('POST', '/', { json: {} });
      assert.equal(r.status, 405);
      assert.equal(r.headers.get('allow'), 'GET, HEAD');
    });

    it('unknown path → 404', async () => {
      const r = await api('GET', '/server.js');
      assert.equal(r.status, 404);
    });
  });
});

describe('500 path with a closed database (L-4)', { timeout: 30000 }, () => {
  it('returns a generic INTERNAL_ERROR without stack or SQL text, then closes cleanly', async () => {
    const app = createApp({ dbPath: ':memory:', port: 0 });
    const { port } = await app.listen();
    const originalError = console.error;
    console.error = () => {}; // keep the expected server-side log out of the test output
    try {
      app.db.close();
      const res = await fetch(`http://127.0.0.1:${port}/api/tasks`);
      const text = await res.text();
      assert.equal(res.status, 500);
      const body = JSON.parse(text);
      assert.equal(body.error.code, 'INTERNAL_ERROR');
      assert.doesNotMatch(text, /\bat /);
      assert.doesNotMatch(text, /SQL/i);
      assert.doesNotMatch(text, /SELECT|database/i);
    } finally {
      console.error = originalError;
      await app.close();
    }
  });

  it('close() is idempotent and works without listen()', async () => {
    const app = createApp({ dbPath: ':memory:' });
    await app.close();
    await app.close();
  });
});
