// Adversarial security tests for the architecture §7 controls (T4).
// NFR-2 (XSS / SQL injection / no disclosure), NFR-3 (loopback binding), FR-8 (no CORS),
// M-1 (Host allowlist negative cases), L-2 (raw-path traversal), L-7 (415 / preflight basis).
//
// Requests are sent with node:http, not fetch: WHATWG URL parsing in fetch normalizes
// `..`, `%2e%2e` and `\` before sending, and fetch does not allow setting Host.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createApp } from '../src/app.js';

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; " +
  "connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

/** Raw request via node:http. `path` is sent exactly as given (no normalization). */
function rawRequest(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Writes a literal HTTP request on a TCP socket and returns the full response text. */
function rawSocket(port, requestText) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.connect({ host: '127.0.0.1', port }, () => socket.end(requestText));
    socket.setTimeout(5000, () => socket.destroy(new Error('raw socket timeout')));
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
  });
}

function postJson(port, path, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  return rawRequest(port, {
    method: 'POST',
    path,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...extraHeaders,
    },
    body,
  });
}

function assertSecurityHeaders(headers, label) {
  assert.equal(headers['content-security-policy'], CSP, `${label}: CSP`);
  assert.equal(headers['x-content-type-options'], 'nosniff', `${label}: nosniff`);
  assert.equal(headers['referrer-policy'], 'no-referrer', `${label}: Referrer-Policy`);
  assert.equal(headers['x-frame-options'], 'DENY', `${label}: X-Frame-Options`);
}

function assertNoCors(headers, label) {
  for (const name of Object.keys(headers)) {
    assert.ok(!name.startsWith('access-control-'), `${label}: unexpected CORS header ${name}`);
  }
}

/** The body must not leak stack frames, file paths or SQL text. */
function assertNoDisclosure(body, label) {
  assert.doesNotMatch(body, /\bat\s+\S+\s*\(/, `${label}: stack frame`);
  assert.doesNotMatch(body, /\bat\s+(file:|node:)/, `${label}: stack frame`);
  assert.doesNotMatch(body, /[A-Za-z]:\\\\|[A-Za-z]:\\|file:\/\//, `${label}: Windows/file path`);
  assert.doesNotMatch(body, /\/(src|test|node_modules)\//, `${label}: source path`);
  assert.doesNotMatch(body, /\.js:\d+/, `${label}: source location`);
  assert.doesNotMatch(body, /\b(SELECT|INSERT|UPDATE|DELETE FROM|CREATE TABLE|SQLITE)\b/i, `${label}: SQL`);
}

describe('security controls', { timeout: 30000 }, () => {
  let app;
  let port;

  before(async () => {
    app = createApp({ dbPath: ':memory:', port: 0 });
    ({ port } = await app.listen());
  });

  after(async () => {
    await app.close();
  });

  describe('security headers', () => {
    const cases = [
      ['GET /', { path: '/' }, 200, false],
      ['GET /app.js', { path: '/app.js' }, 200, false],
      ['GET /api/tasks', { path: '/api/tasks' }, 200, true],
      ['static 404', { path: '/nope.txt' }, 404, false],
      ['API 404', { path: '/api/nope' }, 404, true],
      [
        'API 400',
        {
          method: 'POST',
          path: '/api/tasks',
          headers: { 'Content-Type': 'application/json' },
          body: '{not json',
        },
        400,
        true,
      ],
    ];

    for (const [label, opts, status, isApi] of cases) {
      it(`${label} has the full header set and no CORS`, async () => {
        const r = await rawRequest(port, opts);
        assert.equal(r.status, status, label);
        assertSecurityHeaders(r.headers, label);
        assertNoCors(r.headers, label);
        if (isApi) {
          assert.equal(r.headers['cache-control'], 'no-store', `${label}: Cache-Control`);
        }
      });
    }

    it('421 (wrong Host) responses still carry the security headers', async () => {
      const r = await rawRequest(port, { path: '/', headers: { Host: 'evil.example' } });
      assert.equal(r.status, 421);
      assertSecurityHeaders(r.headers, '421');
      assertNoCors(r.headers, '421');
    });

    it('a CORS preflight (OPTIONS with Origin) is not 2xx and has no CORS headers', async () => {
      const r = await rawRequest(port, {
        method: 'OPTIONS',
        path: '/api/tasks',
        headers: {
          Origin: 'http://evil.example',
          'Access-Control-Request-Method': 'DELETE',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      assert.ok(r.status < 200 || r.status >= 300, `preflight status ${r.status}`);
      assertNoCors(r.headers, 'preflight');
      assertSecurityHeaders(r.headers, 'preflight');
    });

    it('a cross-origin GET with Origin gets no Access-Control-Allow-Origin', async () => {
      const r = await rawRequest(port, {
        path: '/api/tasks',
        headers: { Origin: 'http://evil.example' },
      });
      assert.equal(r.status, 200);
      assertNoCors(r.headers, 'GET with Origin');
    });
  });

  describe('path traversal (raw paths)', () => {
    const paths = [
      '/../server.js',
      '/%2e%2e/src/db.js',
      '/%2E%2E/%2E%2E/package.json',
      '/public/../package.json',
      '/..%2fpackage.json',
      '/..%5cpackage.json',
      '/\\..\\server.js',
      '/public/index.html',
      '/public/app.js',
      '/server.js',
      '/package.json',
      '/src/app.js',
      '/src/db.js',
      '/data/todos.db',
      '/test/security.test.js',
      '/.gitignore',
      '/index.html%00.js',
      '/app.js/',
      '/APP.JS',
      '/api/../server.js',
    ];

    for (const p of paths) {
      it(`GET ${JSON.stringify(p)} → 404 without file contents`, async () => {
        const r = await rawRequest(port, { path: p });
        assert.equal(r.status, 404, `status for ${p}`);
        assert.match(r.headers['content-type'] ?? '', /^application\/json/);
        assert.doesNotMatch(r.body, /\bimport\s/, `${p}: JS source leaked`);
        assert.doesNotMatch(r.body, /CREATE TABLE/i, `${p}: schema leaked`);
        assert.doesNotMatch(r.body, /"name"\s*:\s*"todo-app"/, `${p}: package.json leaked`);
        assert.doesNotMatch(r.body, /SQLite format/, `${p}: DB file leaked`);
        assertSecurityHeaders(r.headers, p);
      });
    }

    it('allowlisted files are still served (control case)', async () => {
      const r = await rawRequest(port, { path: '/styles.css' });
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /^text\/css/);
    });
  });

  describe('Host allowlist (M-1)', () => {
    const otherPort = () => (port === 65535 ? port - 1 : port + 1);

    for (const [label, host] of [
      ['evil.example', () => 'evil.example'],
      ['evil.example with bound port', () => `evil.example:${port}`],
      ['127.0.0.1 on another port', () => `127.0.0.1:${otherPort()}`],
      ['localhost on another port', () => `localhost:${otherPort()}`],
      ['127.0.0.1 without port', () => '127.0.0.1'],
      ['localhost without port', () => 'localhost'],
      ['DNS-rebinding style name', () => `127.0.0.1.nip.io:${port}`],
    ]) {
      it(`Host ${label} → 421`, async () => {
        const r = await rawRequest(port, { path: '/api/tasks', headers: { Host: host() } });
        assert.equal(r.status, 421, label);
        assert.equal(JSON.parse(r.body).error.code, 'MISDIRECTED_REQUEST');
        assert.doesNotMatch(r.body, /"tasks"/);
      });
    }

    // node:http replaces an empty Host with its default, so these go over a raw socket.
    for (const [label, request] of [
      ['empty Host (HTTP/1.1)', 'GET /api/tasks HTTP/1.1\r\nHost: \r\nConnection: close\r\n\r\n'],
      ['missing Host (HTTP/1.0)', 'GET /api/tasks HTTP/1.0\r\n\r\n'],
    ]) {
      it(`${label} is rejected and returns no tasks`, async () => {
        const text = await rawSocket(port, request);
        const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(text)?.[1]);
        // 421 from the allowlist, or 400 if Node's parser rejects it first; never 2xx.
        assert.ok(status === 421 || status === 400, `${label}: status ${status}`);
        assert.doesNotMatch(text, /"tasks"/);
      });
    }

    it('a wrong Host cannot create tasks', async () => {
      const before = JSON.parse((await rawRequest(port, { path: '/api/tasks' })).body).tasks.length;
      const r = await postJson(port, '/api/tasks', { description: 'rebound' }, { Host: 'evil.example' });
      assert.equal(r.status, 421);
      const after = JSON.parse((await rawRequest(port, { path: '/api/tasks' })).body).tasks.length;
      assert.equal(after, before);
    });

    for (const [label, host] of [
      ['127.0.0.1:{port}', () => `127.0.0.1:${port}`],
      ['localhost:{port}', () => `localhost:${port}`],
      ['[::1]:{port}', () => `[::1]:${port}`],
      ['LocalHost:{port} (case-insensitive)', () => `LocalHost:${port}`],
    ]) {
      it(`Host ${label} is accepted`, async () => {
        const r = await rawRequest(port, { path: '/api/tasks', headers: { Host: host() } });
        assert.notEqual(r.status, 421, label);
        assert.equal(r.status, 200, label);
      });
    }
  });

  describe('XSS round trip (NFR-2)', () => {
    it('stores and returns an HTML payload as literal JSON text', async () => {
      const payload = '<img src=x onerror=alert(1)>';
      const created = await postJson(port, '/api/tasks', { description: payload });
      assert.equal(created.status, 201);
      assert.match(created.headers['content-type'], /^application\/json; charset=utf-8$/);
      const task = JSON.parse(created.body);
      assert.equal(task.description, payload);

      const one = await rawRequest(port, { path: `/api/tasks/${task.id}` });
      assert.equal(one.status, 200);
      assert.match(one.headers['content-type'], /^application\/json/);
      assert.doesNotMatch(one.headers['content-type'], /html/i);
      assert.equal(JSON.parse(one.body).description, payload);

      const list = await rawRequest(port, { path: '/api/tasks' });
      assert.match(list.headers['content-type'], /^application\/json/);
      assert.ok(JSON.parse(list.body).tasks.some((t) => t.description === payload));
    });

    it('a script-tag payload is also stored literally', async () => {
      const payload = '"><script>alert(document.cookie)</script>';
      const created = await postJson(port, '/api/tasks', { description: payload });
      assert.equal(created.status, 201);
      assert.equal(JSON.parse(created.body).description, payload);
    });
  });

  describe('SQL injection (NFR-2)', () => {
    for (const payload of [
      "x'); DROP TABLE tasks;--",
      "' OR '1'='1",
      '1; DELETE FROM tasks; --',
    ]) {
      it(`stores ${JSON.stringify(payload)} literally and the table survives`, async () => {
        const created = await postJson(port, '/api/tasks', { description: payload });
        assert.equal(created.status, 201);
        const task = JSON.parse(created.body);
        assert.equal(task.description, payload);

        const list = await rawRequest(port, { path: '/api/tasks' });
        assert.equal(list.status, 200);
        const tasks = JSON.parse(list.body).tasks;
        assert.ok(tasks.some((t) => t.id === task.id && t.description === payload));
        assert.ok(tasks.length >= 1);
      });
    }

    it('a SQL-looking id is treated as not found, not executed', async () => {
      const r = await rawRequest(port, { method: 'DELETE', path: '/api/tasks/1%20OR%201=1' });
      assert.equal(r.status, 404);
      const list = await rawRequest(port, { path: '/api/tasks' });
      assert.ok(JSON.parse(list.body).tasks.length >= 1);
    });

    it('a SQL-looking PATCH description is stored literally', async () => {
      const created = await postJson(port, '/api/tasks', { description: 'patch me' });
      const { id } = JSON.parse(created.body);
      const payload = "done', completed = 1 WHERE 1=1; --";
      const body = JSON.stringify({ description: payload });
      const r = await rawRequest(port, {
        method: 'PATCH',
        path: `/api/tasks/${id}`,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        body,
      });
      assert.equal(r.status, 200);
      const task = JSON.parse(r.body);
      assert.equal(task.description, payload);
      assert.equal(task.completed, false);
    });
  });

  describe('error disclosure', () => {
    it('malformed JSON → 400 INVALID_JSON without internals', async () => {
      const r = await rawRequest(port, {
        method: 'POST',
        path: '/api/tasks',
        headers: { 'Content-Type': 'application/json' },
        body: '{"description": "unterminated',
      });
      assert.equal(r.status, 400);
      const data = JSON.parse(r.body);
      assert.equal(data.error.code, 'INVALID_JSON');
      assert.deepEqual(Object.keys(data), ['error']);
      assert.deepEqual(Object.keys(data.error).sort(), ['code', 'message']);
      assertNoDisclosure(r.body, 'INVALID_JSON');
      assert.doesNotMatch(r.body, /Unexpected|position|SyntaxError/i, 'parser message leaked');
    });

    it('a validation error contains only code and message', async () => {
      const r = await postJson(port, '/api/tasks', { description: 'x', extra: '<b>' });
      assert.equal(r.status, 400);
      const data = JSON.parse(r.body);
      assert.equal(data.error.code, 'VALIDATION_ERROR');
      assert.deepEqual(Object.keys(data.error).sort(), ['code', 'message']);
      assertNoDisclosure(r.body, 'VALIDATION_ERROR');
    });

    it('a closed-DB 500 contains no stack frames, paths or SQL', async (t) => {
      const broken = createApp({ dbPath: ':memory:', port: 0 });
      const { port: brokenPort } = await broken.listen();
      // Silence the expected server-side log for this test only.
      const originalError = console.error;
      t.after(() => {
        console.error = originalError;
      });
      console.error = () => {};
      try {
        broken.db.close();
        for (const req of [
          { path: '/api/tasks' },
          { path: '/api/tasks/1' },
          {
            method: 'POST',
            path: '/api/tasks',
            headers: { 'Content-Type': 'application/json' },
            body: '{"description":"x"}',
          },
        ]) {
          const r = await rawRequest(brokenPort, req);
          assert.equal(r.status, 500, `${req.method ?? 'GET'} ${req.path}`);
          const data = JSON.parse(r.body);
          assert.equal(data.error.code, 'INTERNAL_ERROR');
          assert.deepEqual(Object.keys(data.error).sort(), ['code', 'message']);
          assertNoDisclosure(r.body, '500');
          assert.doesNotMatch(r.body, /database|closed|sqlite/i, '500: DB detail leaked');
          assertSecurityHeaders(r.headers, '500');
        }
      } finally {
        console.error = originalError;
        await broken.close();
      }
    });
  });

  describe('content type / CSRF-style simple requests (L-7 basis)', () => {
    for (const [label, contentType, body] of [
      ['form-urlencoded', 'application/x-www-form-urlencoded', 'description=csrf'],
      ['text/plain', 'text/plain', '{"description":"csrf"}'],
      ['multipart/form-data', 'multipart/form-data; boundary=x', '--x\r\n\r\ncsrf\r\n--x--'],
      ['missing Content-Type', undefined, '{"description":"csrf"}'],
      ['application/json lookalike', 'application/jsonp', '{"description":"csrf"}'],
    ]) {
      it(`POST with ${label} → 415 and no task created`, async () => {
        const beforeList = JSON.parse((await rawRequest(port, { path: '/api/tasks' })).body).tasks;
        const headers = { 'Content-Length': Buffer.byteLength(body), Origin: 'http://evil.example' };
        if (contentType !== undefined) headers['Content-Type'] = contentType;
        const r = await rawRequest(port, { method: 'POST', path: '/api/tasks', headers, body });
        assert.equal(r.status, 415, label);
        assert.equal(JSON.parse(r.body).error.code, 'UNSUPPORTED_MEDIA_TYPE');
        assertNoCors(r.headers, label);
        const afterList = JSON.parse((await rawRequest(port, { path: '/api/tasks' })).body).tasks;
        assert.equal(afterList.length, beforeList.length);
        assert.ok(!afterList.some((t) => t.description === 'csrf'));
      });
    }

    it('PATCH with text/plain → 415 and the task is unchanged', async () => {
      const created = await postJson(port, '/api/tasks', { description: 'keep me' });
      const { id } = JSON.parse(created.body);
      const body = '{"completed":true}';
      const r = await rawRequest(port, {
        method: 'PATCH',
        path: `/api/tasks/${id}`,
        headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) },
        body,
      });
      assert.equal(r.status, 415);
      const one = JSON.parse((await rawRequest(port, { path: `/api/tasks/${id}` })).body);
      assert.equal(one.completed, false);
    });
  });
});

describe('loopback binding (NFR-3)', { timeout: 30000 }, () => {
  it('createApp with no host binds to 127.0.0.1', async () => {
    const app = createApp({ dbPath: ':memory:', port: 0 });
    try {
      const bound = await app.listen();
      assert.equal(app.server.address().address, '127.0.0.1');
      assert.equal(app.address().address, '127.0.0.1');
      assert.equal(bound.host, '127.0.0.1');
    } finally {
      await app.close();
    }
  });
});
