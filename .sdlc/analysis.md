# Todo App — Brownfield Analysis & Enhancement Requirements

## 1. Application overview and technology stack
### Verified facts (from `todo-app/README.md`)
- Purpose: a local Todo app to add, view, edit, complete/reopen, and delete tasks; tasks persist in a SQLite database file across refreshes/restarts.
- Backend: Node.js built-ins only (`node:http`, `node:sqlite`). Serves a JSON REST API and static frontend.
- Frontend: plain HTML/CSS/JS in `todo-app/public/` with no build step.
- No authentication; one shared task list for any user who can reach the local port.

### Key entry points (verified)
- Server entry: `todo-app/server.js`
- HTTP app factory: `todo-app/src/app.js`
- REST API handlers: `todo-app/src/api.js`
- Persistence/repository: `todo-app/src/db.js`
- Frontend: `todo-app/public/index.html`, `todo-app/public/app.js`, `todo-app/public/styles.css`

## 2. Repository path, branch, commit SHA, and working-tree status
### Verified via git CLI (repo root: `C:/Users/PalashManna/Desktop/Copilot-capston/capstone-github`)
- **Branch:** `story/todo-application-20261110065333-2618c391`
- **Commit SHA:** `affd3c9ff0055b3a71536ac264a679db8828ffda`
- **Working tree (porcelain):**
  - `?? todo-app/.sdlc/`
  - `?? todo-app/repo/`

> Note (verified): `todo-app/.sdlc/` is currently **untracked** in this working tree. This workflow writes `todo-app/.sdlc/analysis.md` as requested.

## 3. Existing capabilities (with file references)
### 3.1 UI capabilities (verified)
- Add a task from the “New task” input.
  - Evidence: `public/index.html` form `#add-form`, input `#new-task`.
  - Evidence: `public/app.js` `addTask()` validates then calls `POST /api/tasks`.
- View tasks list and an empty state.
  - Evidence: `public/index.html` `#task-list` and `#empty-state`.
  - Evidence: `public/app.js` `loadTasks()` fetches list and `render()` updates DOM.
- Mark complete / reopen via checkbox.
  - Evidence: `public/app.js` `renderItem()` checkbox `change` → `toggleTask()` → `PATCH /api/tasks/{id}` with `{ completed }`.
- Edit a task description inline.
  - Evidence: `public/app.js` `startEdit()` / `renderEditItem()` / `saveEdit()` → `PATCH /api/tasks/{id}` with `{ description }`.
- Delete a task.
  - Evidence: `public/app.js` `renderItem()` creates Delete button that calls `deleteTask(task)`.
  - Evidence: `public/app.js` `deleteTask(task)` calls `mutate('DELETE', ...)`.

### 3.2 Server/API capabilities (verified)
- REST API under `/api/tasks` with list/create/get/update/delete.
  - Evidence: `src/api.js` routes:
    - `GET /api/tasks` → `repo.list()`
    - `POST /api/tasks` → `repo.create()`
    - `GET /api/tasks/{id}` → `repo.get()`
    - `PATCH /api/tasks/{id}` → `repo.update()`
    - `DELETE /api/tasks/{id}` → `repo.remove()`
  - Evidence: `README.md` “API summary” table.

### 3.3 Persistence and data model (verified)
- SQLite database table `tasks` with:
  - `description` 1..200 characters (DB CHECK) and `completed` boolean-like integer.
  - Evidence: `src/db.js` `SCHEMA`.
- Created/updated timestamps are stored and returned to clients.
  - Evidence: `src/db.js` `toTask()` returns `createdAt`, `updatedAt`.

### 3.4 Validation and security posture (verified)
- Input validation for description is implemented on both server and client.
  - Evidence: `src/validation.js` `validateDescription()` and `MAX_DESCRIPTION = 200`.
  - Evidence: `public/app.js` client mirror `validateDescription()`.
- Security headers are applied for all responses (CSP, nosniff, etc.).
  - Evidence: `src/http-utils.js` `applySecurityHeaders()`.
- Host header allowlist is enforced.
  - Evidence: `src/app.js` checks `allowedHosts` and returns 421 when disallowed.

## 4. Enhancement recommendation (exactly one small enhancement)
### Verified gap / opportunity
**Deletion is immediate and irreversible from the UI, with no confirmation.**
- Evidence (code): `public/app.js` `deleteTask(task)` immediately calls `mutate('DELETE', ...)` with no confirmation prompt.
- Evidence (documentation): `README.md` → “Limitations”: “Delete is immediate, with no confirmation and no undo.”

### Recommended enhancement (proposed)
**Add a delete confirmation prompt before calling the delete API.**
- Small, localized change (front-end only) that reduces accidental deletions.
- No API changes required; uses existing `DELETE /api/tasks/{id}`.

## 5. Human-selected enhancement and approval status
- **Selected enhancement:** Add delete confirmation prompt.
- **Approval status:** Approved by human for publication.

### Confluence publication (verified)
- **Parent page verified:** `622769` (title: `github-capstone`, space: `githubcaps`).
- **Exact-title duplicate check:** No page found with title `Todo App - Enhancement Requirements` prior to create.
- **Created page title:** `Todo App - Enhancement Requirements`
- **Created page ID:** `7634945`
- **URL:** https://epam-sdlc-pipeline.atlassian.net/wiki/spaces/githubcaps/pages/7634945/Todo+App+-+Enhancement+Requirements

---

## 6. User story
### Summary
As a user, I want to confirm before deleting a task so that I don’t accidentally remove tasks.

### General description
When a user clicks **Delete** on a task in the list, the UI asks for confirmation. If the user confirms, the app deletes the selected task via the existing REST API and refreshes the list. If the user cancels/dismisses, the app performs no deletion and keeps the current UI state.

### Business Value
Reduces accidental and irreversible data loss in a shared, no-login Todo list.

### Preconditions
- Todo server is running and the task list loads successfully.
- At least one task is visible in the list.

### Scenarios of use
1. **Confirm deletion**
   - User clicks **Delete** on a task.
   - UI shows a confirmation prompt mentioning the task.
   - User confirms.
2. **Cancel deletion**
   - User clicks **Delete** on a task.
   - UI shows a confirmation prompt.
   - User cancels/dismisses.

### Expected result
- **Confirm:** Task is deleted via `DELETE /api/tasks/{id}` and is no longer shown after refresh.
- **Cancel:** No delete request is sent and the task remains visible.

### Affected areas
- Frontend: `todo-app/public/app.js` (Delete button handler and `deleteTask(task)`)
- Frontend copy only: confirmation prompt message.

### Acceptance criteria
- The app must display a confirmation prompt before sending a delete request.
- The prompt must identify the task to be deleted using its description (or equivalent user-visible identifier).
- If the user cancels, no deletion occurs and no request is sent.

---

## 7. Requirement IDs and testable Given/When/Then criteria
### FR-DEL-001 — Confirmation required
**Requirement:** The UI must ask for confirmation before deleting a task.
- **Given** a task is displayed in the task list
- **When** the user clicks **Delete** for that task
- **Then** the UI displays a confirmation prompt before any API request is sent

### FR-DEL-002 — Delete only on confirm
**Requirement:** The UI must call the delete API only when the user confirms.
- **Given** the confirmation prompt is shown for task *T*
- **When** the user confirms
- **Then** the UI sends `DELETE /api/tasks/{id}` for task *T*
- **And** on success, the UI refreshes and *T* is no longer present

### FR-DEL-003 — Cancel leaves state unchanged
**Requirement:** Cancelling deletion must not change data or UI state.
- **Given** the confirmation prompt is shown for task *T*
- **When** the user cancels/dismisses
- **Then** the UI does not send `DELETE /api/tasks/{id}`
- **And** *T* remains visible in the list

### NFR-DEL-001 — No unsafe rendering introduced
**Requirement:** The confirmation prompt text must be treated as plain text.
- **Given** a task description contains characters like `<` or `&`
- **When** the confirmation prompt is shown
- **Then** the prompt displays the characters literally (no HTML interpretation)

## 8. Scope exclusions, assumptions, risks, and open questions
### Scope exclusions
- No “Undo delete” feature.
- No backend/API changes.
- No authentication/authorization changes.
- No changes to sorting/grouping.

### Assumptions
- A browser-native confirmation (e.g., `window.confirm`) is acceptable for the current UX baseline.

### Risks
- Minor UX friction (extra click) for frequent deleters; mitigated by the irreversibility of delete.

### Open questions
- Q1: Should the confirmation include the full description text or truncate it? (Proposal: include description, truncation optional.)
- Q2: Should delete be blocked while editing a task? (Proposal: keep current behaviour; busy-state already prevents concurrent mutations.)

## 9. Supporting sources and approved Confluence links
### Local sources inspected (verified)
- `todo-app/README.md` (capabilities, limitations, API)
- `todo-app/public/index.html` (UI elements)
- `todo-app/public/app.js` (UI behaviour; delete is immediate)
- `todo-app/src/api.js` (API routing)
- `todo-app/src/db.js` (persistence)
- `todo-app/src/app.js` and `todo-app/src/http-utils.js` (request pipeline and security headers)

### Confluence (verified)
- `Todo App - Enhancement Requirements` — https://epam-sdlc-pipeline.atlassian.net/wiki/spaces/githubcaps/pages/7634945/Todo+App+-+Enhancement+Requirements

## 10. Handoff notes for the Implementation Planner
- This enhancement should be implemented entirely in the frontend (`public/app.js`).
- Primary change point: the Delete button click path (`renderItem()` → `deleteTask(task)`).
- Implementation must ensure:
  - Cancel/dismiss results in **no** call to `mutate('DELETE', ...)`.
  - Confirm proceeds with existing behaviour.
- No REST API or DB changes are required.
