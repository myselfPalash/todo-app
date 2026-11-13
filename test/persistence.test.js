// AC6 / FR-6: tasks survive a full app restart on the same database file (M-2 cleanup).
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

describe('persistence across restart (AC6)', { timeout: 30000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-'));
  const dbPath = path.join(dir, 'todos.db');
  const apps = [];

  after(async () => {
    for (const app of apps) await app.close(); // idempotent; DB must be closed before rmSync
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  async function start() {
    const app = createApp({ dbPath, port: 0 });
    apps.push(app);
    const { port } = await app.listen();
    const base = `http://127.0.0.1:${port}`;
    const call = async (method, p, json) => {
      const res = await fetch(`${base}${p}`, {
        method,
        headers: json ? { 'Content-Type': 'application/json' } : {},
        body: json ? JSON.stringify(json) : undefined,
      });
      const text = await res.text();
      return { status: res.status, data: text ? JSON.parse(text) : null };
    };
    return { app, call };
  }

  it('keeps ids, descriptions, status and timestamps; continues the id sequence', async () => {
    const a = await start();
    const ids = [];
    for (const d of ['alpha', 'beta', 'gamma']) {
      const r = await a.call('POST', '/api/tasks', { description: d });
      assert.equal(r.status, 201);
      ids.push(r.data.id);
    }
    const toggled = await a.call('PATCH', `/api/tasks/${ids[1]}`, { completed: true });
    assert.equal(toggled.status, 200);
    const listA = (await a.call('GET', '/api/tasks')).data.tasks;
    assert.equal(listA.length, 3);
    await a.app.close();

    assert.ok(fs.existsSync(dbPath), 'database file exists after close');

    const b = await start();
    const listB = (await b.call('GET', '/api/tasks')).data.tasks;
    assert.deepEqual(listB, listA);
    assert.equal(listB[1].completed, true);

    const next = await b.call('POST', '/api/tasks', { description: 'delta' });
    assert.equal(next.status, 201);
    assert.equal(next.data.id, Math.max(...ids) + 1);
    await b.app.close();
  });
});
