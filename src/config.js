// Environment configuration for server.js (NFR-3). Pure: no I/O.
import path from 'node:path';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3000;
export const MEMORY_DB = ':memory:';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function readVar(env, name) {
  const value = env[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Builds the runtime configuration.
 * @param {Record<string, string|undefined>} env  usually process.env
 * @param {string} appDir  absolute path of the todo-app folder
 * @returns {{ host: string, port: number, dbPath: string, warnings: string[] }}
 * @throws {Error} with a one-line message when a value is invalid
 */
export function loadConfig(env = {}, appDir) {
  if (typeof appDir !== 'string' || !path.isAbsolute(appDir)) {
    throw new Error('loadConfig: appDir must be an absolute path.');
  }
  const warnings = [];

  const host = readVar(env, 'TODO_HOST') ?? DEFAULT_HOST;
  if (!LOOPBACK_HOSTS.has(host.toLowerCase())) {
    warnings.push(
      `TODO_HOST is "${host}", which is not a loopback address; the app may be reachable from other machines.`
    );
  }

  const rawPort = readVar(env, 'TODO_PORT');
  let port = DEFAULT_PORT;
  if (rawPort !== undefined) {
    const parsed = /^[0-9]{1,5}$/.test(rawPort) ? Number(rawPort) : NaN;
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      throw new Error(`Invalid TODO_PORT "${rawPort}": must be an integer from 0 to 65535.`);
    }
    port = parsed;
  }

  const rawDbPath = readVar(env, 'TODO_DB_PATH');
  let dbPath;
  if (rawDbPath === undefined) {
    dbPath = path.join(appDir, 'data', 'todos.db');
  } else if (rawDbPath === MEMORY_DB) {
    dbPath = MEMORY_DB;
    warnings.push('TODO_DB_PATH is ":memory:"; data will not persist after the server stops.');
  } else if (path.isAbsolute(rawDbPath)) {
    dbPath = rawDbPath;
  } else {
    // Relative paths resolve against the todo-app folder, not the cwd (L-5).
    dbPath = path.resolve(appDir, rawDbPath);
  }

  return { host, port, dbPath, warnings };
}
