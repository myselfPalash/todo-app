import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, DEFAULT_HOST, DEFAULT_PORT } from '../src/config.js';

const appDir = path.resolve(os.tmpdir(), 'fake-todo-app');

describe('loadConfig', () => {
  it('uses defaults when nothing is set', () => {
    const cfg = loadConfig({}, appDir);
    assert.deepEqual(cfg, {
      host: '127.0.0.1',
      port: 3000,
      dbPath: path.join(appDir, 'data', 'todos.db'),
      warnings: [],
    });
    assert.equal(DEFAULT_HOST, '127.0.0.1');
    assert.equal(DEFAULT_PORT, 3000);
  });

  it('treats empty strings as unset', () => {
    const cfg = loadConfig({ TODO_HOST: '', TODO_PORT: '', TODO_DB_PATH: '' }, appDir);
    assert.equal(cfg.host, '127.0.0.1');
    assert.equal(cfg.port, 3000);
    assert.equal(cfg.dbPath, path.join(appDir, 'data', 'todos.db'));
  });

  it('resolves a relative DB path against appDir, not the cwd (L-5)', () => {
    const cfg = loadConfig({ TODO_DB_PATH: 'other/my.db' }, appDir);
    assert.equal(cfg.dbPath, path.join(appDir, 'other', 'my.db'));
    const up = loadConfig({ TODO_DB_PATH: '../x.db' }, appDir);
    assert.equal(up.dbPath, path.resolve(appDir, '..', 'x.db'));
    assert.deepEqual(cfg.warnings, []);
  });

  it('keeps an absolute DB path', () => {
    const abs = path.resolve(os.tmpdir(), 'somewhere', 'todos.db');
    assert.equal(loadConfig({ TODO_DB_PATH: abs }, appDir).dbPath, abs);
  });

  it('keeps :memory: and warns that data will not persist', () => {
    const cfg = loadConfig({ TODO_DB_PATH: ':memory:' }, appDir);
    assert.equal(cfg.dbPath, ':memory:');
    assert.equal(cfg.warnings.length, 1);
    assert.match(cfg.warnings[0], /will not persist/);
  });

  it('accepts valid ports including 0 and 65535', () => {
    assert.equal(loadConfig({ TODO_PORT: '0' }, appDir).port, 0);
    assert.equal(loadConfig({ TODO_PORT: '8080' }, appDir).port, 8080);
    assert.equal(loadConfig({ TODO_PORT: '65535' }, appDir).port, 65535);
  });

  it('throws a one-line error for invalid ports', () => {
    for (const p of ['-1', '65536', 'abc', '3.5', '1e3', ' 80', '80 ', '999999', '0x10']) {
      assert.throws(
        () => loadConfig({ TODO_PORT: p }, appDir),
        (err) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /TODO_PORT/);
          assert.ok(!err.message.includes('\n'), 'message must be one line');
          return true;
        },
        `port ${JSON.stringify(p)} should be rejected`
      );
    }
  });

  it('does not warn for loopback hosts', () => {
    for (const h of ['127.0.0.1', 'localhost', 'LOCALHOST', '::1']) {
      const cfg = loadConfig({ TODO_HOST: h }, appDir);
      assert.equal(cfg.host, h);
      assert.deepEqual(cfg.warnings, []);
    }
  });

  it('warns for a non-loopback host', () => {
    const cfg = loadConfig({ TODO_HOST: '0.0.0.0' }, appDir);
    assert.equal(cfg.host, '0.0.0.0');
    assert.equal(cfg.warnings.length, 1);
    assert.match(cfg.warnings[0], /not a loopback/);
  });

  it('can report several warnings together', () => {
    const cfg = loadConfig({ TODO_HOST: '192.168.1.5', TODO_DB_PATH: ':memory:' }, appDir);
    assert.equal(cfg.warnings.length, 2);
  });

  it('requires an absolute appDir', () => {
    assert.throws(() => loadConfig({}, 'relative/dir'), /appDir/);
    assert.throws(() => loadConfig({}), /appDir/);
  });
});
