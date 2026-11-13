# Todo Application

A simple local Todo app. You can add, view, edit, complete or reopen, and delete tasks. Tasks are stored in a SQLite database file, so they are still there after a page refresh or a server restart.

- Backend: Node.js built-ins only (`node:http`, `node:sqlite`). Serves a JSON REST API and the static frontend.
- Frontend: plain HTML, CSS and JavaScript in `public/`. No build step.
- No third-party dependencies, no `npm install` step, and no network access needed.
- No login. Everyone who uses the app shares one task list.

> Status: automated delivery draft. Not human-approved.

## Requirements
- Node.js **24 or later** (`engines.node >= 24`). Tested with Node v24.22.1 on Windows.
- Nothing to install. `package.json` has no dependencies.
- On Windows PowerShell, use `npm.cmd` instead of `npm` if script execution policy blocks `npm.ps1`.

## Start
```
cd todo-app
npm.cmd start
```
or, without npm:
```
cd todo-app
node server.js
```
Then open **http://127.0.0.1:3000** in a browser. The console prints `Todo app listening on http://127.0.0.1:3000`.

## Stop
Press **Ctrl+C** in the console where the server runs. The server then closes open connections and the database and exits. On Windows, SIGTERM is not delivered reliably, so Ctrl+C (SIGINT) is the supported stop method.

## Configuration
Set these environment variables before starting the server. All are optional.

| Variable | Default | Notes |
|----------|---------|-------|
| `TODO_HOST` | `127.0.0.1` | Address to listen on. A non-loopback value prints a warning, because the app then may be reachable from other machines. |
| `TODO_PORT` | `3000` | Integer from 0 to 65535. `0` picks a free port. Any other value makes the server print a one-line error and exit with code 1. |
| `TODO_DB_PATH` | `todo-app/data/todos.db` | SQLite file. A **relative** path is resolved against the `todo-app/` folder, not the current directory. The parent folder is created if missing. `:memory:` is accepted, but data is lost when the server stops (a warning is printed). |

Example (`cmd.exe`):
```
cd todo-app
set TODO_PORT=3999&& set TODO_DB_PATH=%TEMP%\todo-smoke.db&& node server.js
```
Example (PowerShell):
```
cd todo-app
$env:TODO_PORT = "3999"; node server.js
```

The server allows only requests whose `Host` header is `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`, or the configured host and port. Other values get `421 Misdirected Request`. Use one of these addresses in the browser.

## Data location
By default tasks are stored in `todo-app/data/todos.db`. The `data/` folder is listed in `todo-app/.gitignore`, so it is not committed. To start with an empty list, stop the server and delete that file. Tests never use this file. They use in-memory or temporary databases.

## Tests
```
cd todo-app
node --test test/*.test.js
```
or `npm.cmd test` (same command). Run a single file with `node --test test/api.test.js`.

The suite uses Node's built-in test runner. It covers validation, configuration, the database layer, frontend static checks (no `innerHTML`, labels, no inline scripts), the HTTP API, persistence across a server restart, and security (headers, path traversal, Host check, XSS and SQL injection round trips, error disclosure, content types).

## API summary
Base path `/api/tasks`. Responses are JSON (`application/json; charset=utf-8`), except `204`.

Task object:
```json
{ "id": 1, "description": "Buy milk", "completed": false, "createdAt": "2026-11-10T07:00:00.000Z", "updatedAt": "2026-11-10T07:00:00.000Z" }
```
Error object: `{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }`. Errors never contain stack traces or SQL text.

| Method and path | Request body | Success | Errors |
|-----------------|--------------|---------|--------|
| `GET /api/tasks` | none | `200 { "tasks": Task[] }`, oldest first | none |
| `POST /api/tasks` | `{ "description": string }` | `201 Task` with `Location: /api/tasks/{id}`; new tasks are `completed: false` | 400, 413, 415 |
| `GET /api/tasks/{id}` | none | `200 Task` | 404 |
| `PATCH /api/tasks/{id}` | `{ "description"?: string, "completed"?: boolean }` (at least one) | `200 Task` with a new `updatedAt` | 400, 404, 413, 415 |
| `DELETE /api/tasks/{id}` | none | `204`, no body | 404 |
| Other method on a known path | | | 405 with an `Allow` header |
| Unknown `/api/...` path | | | 404 |

Rules:
- `POST` and `PATCH` need `Content-Type: application/json` (otherwise 415). The body limit is 4 KiB (otherwise 413). Invalid JSON gives 400 `INVALID_JSON`.
- Unknown fields (including `id`, `createdAt`, `updatedAt`) give 400. `PATCH {}` gives 400.
- `description` is trimmed and must then be 1 to 200 Unicode code points. `completed` must be a JSON boolean (`"true"` or `1` are rejected).
- `{id}` must be a positive integer without leading zeros. Anything else gives 404.
- Other status codes: `421` for a disallowed `Host` header, and `500 INTERNAL_ERROR` with a generic message for unexpected errors (details are logged on the server console only).

## ExperimentalWarning
`node:sqlite` is marked experimental in Node 24. Node may print `ExperimentalWarning: SQLite is an experimental feature ...` on stderr. This is expected and harmless. `npm.cmd start` passes `--disable-warning=ExperimentalWarning`, so it hides the warning. `node server.js` and the tests do not hide it. On Node v24.22.1 no ExperimentalWarning was seen during this delivery, but other Node versions may print it.

## Limitations
- One shared task list with no login or accounts. Any local user or process that can reach the port can change tasks.
- Local use only: no HTTPS, rate limiting, backups or migrations.
- No automated browser (UI) tests. UI behaviour is checked manually, supported by static checks on the frontend files.
- Graceful shutdown on Ctrl+C is implemented but was not exercised by an automated test.
- Length limit: the input field has `maxlength="200"`, which counts UTF-16 code units, while the server counts Unicode code points. For characters outside the Basic Multilingual Plane (for example many emoji), the browser input stops earlier (around 100 emoji) than the server limit of 200. The client is stricter, never looser.
- Descriptions are single-line. The client and the server reject control characters (U+0000 to U+001F, U+007F), C1 control characters (U+0080 to U+009F), the line and paragraph separators U+2028 and U+2029, and malformed text (lone surrogates).
- Duplicate descriptions are allowed.
- Delete is immediate, with no confirmation and no undo.
- Tasks are always shown in creation order (oldest first). Completed tasks are not grouped separately.
- Concurrent edits from several tabs follow last-write-wins. If a task was deleted in another tab, the UI shows the error and reloads the list.
- Synchronous SQLite calls are fine for one local user but not for multi-user load.

## Open questions (unconfirmed defaults)
These were not answered by the story. The app uses the default shown; a human should confirm them.

| # | Question | Current default |
|---|----------|-----------------|
| Q1 | Which database is required? | SQLite through the built-in `node:sqlite` (experimental in Node 24). |
| Q2 | Maximum description length; are duplicates allowed? | 200 code points after trimming; single line; duplicates allowed. |
| Q3 | Should delete require confirmation? | No, delete is immediate. |
| Q4 | How does the app relate to the existing welcome page? | Separate app in `todo-app/`. The welcome page (`index.html`) is unchanged and does not link to it. |
| Q5 | Browser support or WCAG targets? | None beyond basics: labels, accessible button names, keyboard use, status shown as text, not only colour. |
| Q6 | Sort order; group completed tasks? | Creation order, not grouped. |
