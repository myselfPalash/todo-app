// SQLite persistence (FR-6) via the built-in node:sqlite module.
// All node:sqlite usage is isolated in this file (L-9).
// Every statement is prepared with ? placeholders; no SQL is built from input (NFR-2).
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT    NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  completed   INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
`;

function toTask(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    description: row.description,
    completed: row.completed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function now() {
  return new Date().toISOString();
}

/**
 * Opens (and if needed initializes) the database and returns the task repository.
 * The parent directory must already exist (server.js creates it).
 * @param {string} dbPath file path or ':memory:'
 */
export function openDatabase(dbPath) {
  let db;
  try {
    db = new DatabaseSync(dbPath);
    db.exec(SCHEMA);
    const { user_version: version } = db.prepare('PRAGMA user_version').get();
    if (version === 0) {
      // PRAGMA values cannot be bound; SCHEMA_VERSION is a code constant, not input.
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
  } catch (err) {
    if (db) {
      try { db.close(); } catch { /* already closed */ }
    }
    throw new Error(`Cannot open database at "${dbPath}": ${err.message}`, { cause: err });
  }

  const stmts = {
    list: db.prepare(
      'SELECT id, description, completed, created_at, updated_at FROM tasks ORDER BY id ASC'
    ),
    get: db.prepare(
      'SELECT id, description, completed, created_at, updated_at FROM tasks WHERE id = ?'
    ),
    insert: db.prepare(
      'INSERT INTO tasks (description, completed, created_at, updated_at) VALUES (?, 0, ?, ?)'
    ),
    update: db.prepare(
      'UPDATE tasks SET description = ?, completed = ?, updated_at = ? WHERE id = ?'
    ),
    remove: db.prepare('DELETE FROM tasks WHERE id = ?'),
  };

  let closed = false;

  const repo = {
    /** All tasks in creation order (A-5). */
    list() {
      return stmts.list.all().map(toTask);
    },

    /** One task, or null if the ID is unknown. */
    get(id) {
      return toTask(stmts.get.get(id));
    },

    /** Creates a pending task and returns it. */
    create(description) {
      const timestamp = now();
      const { lastInsertRowid } = stmts.insert.run(description, timestamp, timestamp);
      return repo.get(Number(lastInsertRowid));
    },

    /** Updates description and/or completed. Returns the updated task, or null if unknown. */
    update(id, changes = {}) {
      const existing = repo.get(id);
      if (!existing) return null;
      const description =
        changes.description !== undefined ? changes.description : existing.description;
      const completed =
        changes.completed !== undefined ? changes.completed : existing.completed;
      stmts.update.run(description, completed ? 1 : 0, now(), id);
      return repo.get(id);
    },

    /** Deletes a task. Returns true if a row was removed, false if the ID is unknown. */
    remove(id) {
      return stmts.remove.run(id).changes > 0;
    },

    /** Closes the database. Safe to call more than once (M-2). */
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };

  return repo;
}
