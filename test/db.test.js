import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db.js';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}

describe('db repository (:memory:)', () => {
  let repo;
  before(() => {
    repo = openDatabase(':memory:');
  });
  after(() => {
    repo.close();
  });

  it('starts empty', () => {
    assert.deepEqual(repo.list(), []);
  });

  it('creates a pending task with ISO-8601 UTC timestamps', () => {
    const t = repo.create('Buy milk');
    assert.equal(typeof t.id, 'number');
    assert.equal(t.description, 'Buy milk');
    assert.equal(t.completed, false);
    assert.match(t.createdAt, ISO_UTC);
    assert.equal(t.updatedAt, t.createdAt);
    assert.deepEqual(Object.keys(t).sort(), ['completed', 'createdAt', 'description', 'id', 'updatedAt']);
    assert.deepEqual(repo.get(t.id), t);
  });

  it('lists tasks in id ASC (creation) order', () => {
    const a = repo.create('second');
    const b = repo.create('third');
    const ids = repo.list().map((t) => t.id);
    assert.deepEqual(ids, [...ids].sort((x, y) => x - y));
    assert.deepEqual(ids.slice(-2), [a.id, b.id]);
  });

  it('maps completed to a boolean and updates it both ways', () => {
    const t = repo.create('toggle me');
    const done = repo.update(t.id, { completed: true });
    assert.equal(done.completed, true);
    assert.equal(repo.get(t.id).completed, true);
    const back = repo.update(t.id, { completed: false });
    assert.equal(back.completed, false);
    assert.equal(repo.get(t.id).completed, false);
  });

  it('updates the description and refreshes updatedAt', () => {
    const t = repo.create('old text');
    const u = repo.update(t.id, { description: 'new text' });
    assert.equal(u.description, 'new text');
    assert.equal(u.completed, false);
    assert.equal(u.createdAt, t.createdAt);
    assert.match(u.updatedAt, ISO_UTC);
    assert.ok(u.updatedAt >= u.createdAt);
  });

  it('updates both fields at once and leaves omitted fields unchanged', () => {
    const t = repo.create('both');
    const u = repo.update(t.id, { description: 'both!', completed: true });
    assert.equal(u.description, 'both!');
    assert.equal(u.completed, true);
    const v = repo.update(t.id, { completed: false });
    assert.equal(v.description, 'both!');
  });

  it('returns null / false for unknown IDs', () => {
    assert.equal(repo.get(999999), null);
    assert.equal(repo.update(999999, { completed: true }), null);
    assert.equal(repo.remove(999999), false);
  });

  it('removes tasks', () => {
    const t = repo.create('delete me');
    assert.equal(repo.remove(t.id), true);
    assert.equal(repo.get(t.id), null);
    assert.ok(!repo.list().some((x) => x.id === t.id));
    assert.equal(repo.remove(t.id), false);
  });

  it('stores SQL-looking and HTML-looking input literally (NFR-2)', () => {
    const sql = "'); DROP TABLE tasks;--";
    const html = '<img src=x onerror=alert(1)>';
    const a = repo.create(sql);
    const b = repo.create(html);
    assert.equal(repo.get(a.id).description, sql);
    assert.equal(repo.get(b.id).description, html);
    assert.ok(repo.list().length >= 2, 'table still exists and lists rows');
  });

  it('stores multi-byte text (200 emoji) unchanged', () => {
    const s = '😀'.repeat(200);
    const t = repo.create(s);
    assert.equal(repo.get(t.id).description, s);
  });
});

describe('db repository: IDs are never reused', () => {
  it('create 1, 2 -> delete 2 -> create gives id 3', () => {
    const repo = openDatabase(':memory:');
    try {
      assert.equal(repo.create('one').id, 1);
      assert.equal(repo.create('two').id, 2);
      assert.equal(repo.remove(2), true);
      assert.equal(repo.create('three').id, 3);
      assert.deepEqual(repo.list().map((t) => t.id), [1, 3]);
    } finally {
      repo.close();
    }
  });
});

describe('db close()', () => {
  it('is idempotent', () => {
    const repo = openDatabase(':memory:');
    repo.close();
    assert.doesNotThrow(() => repo.close());
  });

  it('makes later operations throw (basis for the 500 test, L-4)', () => {
    const repo = openDatabase(':memory:');
    repo.close();
    assert.throws(() => repo.list());
  });
});

describe('db open errors', () => {
  it('throws a clear error when the parent directory does not exist', () => {
    const missing = path.join(os.tmpdir(), `todo-missing-${process.pid}-${Date.now()}`, 'x', 'todos.db');
    assert.throws(() => openDatabase(missing), /Cannot open database/);
    assert.equal(fs.existsSync(path.dirname(missing)), false, 'openDatabase must not create directories');
  });
});

describe('db repository (temp file)', () => {
  let dir;
  let dbFile;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-'));
    dbFile = path.join(dir, 'todos.db');
  });

  after(() => {
    removeDir(dir);
  });

  it('persists rows across close and reopen, with user_version = 1', () => {
    const first = openDatabase(dbFile);
    first.create('persist A');
    const b = first.create('persist B');
    first.update(b.id, { completed: true });
    const before = first.list();
    first.close();

    const second = openDatabase(dbFile);
    try {
      assert.deepEqual(second.list(), before);
    } finally {
      second.close();
    }

    const raw = new DatabaseSync(dbFile);
    try {
      assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 1);
      const mode = raw.prepare('PRAGMA journal_mode').get().journal_mode;
      assert.notEqual(String(mode).toLowerCase(), 'wal');
    } finally {
      raw.close();
    }
  });

  it('enforces CHECK constraints on direct inserts', () => {
    openDatabase(dbFile).close(); // ensure schema exists
    const raw = new DatabaseSync(dbFile);
    try {
      const insert = raw.prepare(
        'INSERT INTO tasks (description, completed, created_at, updated_at) VALUES (?, ?, ?, ?)'
      );
      const ts = new Date().toISOString();
      assert.throws(() => insert.run('', 0, ts, ts), /CHECK constraint/i);
      assert.throws(() => insert.run('a'.repeat(201), 0, ts, ts), /CHECK constraint/i);
      assert.throws(() => insert.run('ok', 2, ts, ts), /CHECK constraint/i);
      assert.doesNotThrow(() => insert.run('a'.repeat(200), 0, ts, ts));
    } finally {
      raw.close();
    }
  });
});
