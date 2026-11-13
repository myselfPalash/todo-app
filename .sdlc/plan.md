# Implementation Plan — Todo App Enhancement: Delete Confirmation Prompt

## 1. Selected enhancement and approved requirement references
**Selected enhancement:** Add a delete confirmation prompt before deleting a task in the UI.

**Approved requirement source:**
- BA handoff: `todo-app/.sdlc/analysis.md`
- Published Confluence story: **Todo App - Enhancement Requirements** (page ID **7634945**)  
  https://epam-sdlc-pipeline.atlassian.net/wiki/spaces/githubcaps/pages/7634945/Todo+App+-+Enhancement+Requirements

**Requirement IDs (from analysis):**
- **FR-DEL-001** — Confirmation required
- **FR-DEL-002** — Delete only on confirm
- **FR-DEL-003** — Cancel leaves state unchanged
- **NFR-DEL-001** — No unsafe rendering introduced

## 2. Repository path, branch, and current commit SHA
- **Git repository root:** `C:\Users\PalashManna\Desktop\Copilot-capston\capstone-github`
- **Application folder:** `C:\Users\PalashManna\Desktop\Copilot-capston\capstone-github\todo-app`
- **Verified branch:** `story/todo-application-20261110065333-2618c391`
- **Verified commit SHA:** `affd3c9ff0055b3a71536ac264a679db8828ffda`

## 3. Analysis handoff path and source references
- BA handoff (local): `todo-app/.sdlc/analysis.md`
- Primary implementation touchpoint:
  - `todo-app/public/app.js`:
    - Delete button wiring: `renderItem(task)` creates Delete button -> `deleteTask(task)`
    - Existing delete action: `deleteTask(task)` calls `mutate('DELETE', ...)` directly (no confirmation)
- Existing test harness:
  - Node test runner: `todo-app/package.json` -> `"test": "node --test test/*.test.js"`
  - Static frontend constraints: `todo-app/test/frontend-static.test.js`

## 4. Scope and exclusions
### In scope
- Add a confirmation prompt that appears **before** any delete API call.
- Prompt must identify the task being deleted using its description.
- Cancel/dismiss must result in **no** delete request and no UI state change.

### Explicit exclusions (per analysis)
- No undo.
- No backend/API changes.
- No DB changes.
- No changes to sorting/grouping, authentication, or authorization.

## 5. Affected components and relevant files
### Frontend (existing files)
- **Modify:** `todo-app/public/app.js`

### Tests (existing files)
- **Modify/Add:** `todo-app/test/frontend-static.test.js` (add a small regression assertion)

### New files (proposed additions)
- **Add:** `todo-app/test/delete-confirmation.test.js` (Node-level unit test for confirmation gating by stubbing `window.confirm`) **only if feasible** with current test setup.
  - If current tests do not execute browser code easily, keep this as a manual/Playwright alternative (see §12).

## 6. Ordered implementation tasks and dependencies
### Task 1 — Confirm current delete flow and constraints (no deps)
1. Re-check `todo-app/public/app.js` for:
   - busy-state behavior (`busy` + `setBusy`) and mutation pattern (`mutate()`)
   - any existing confirmation patterns (none expected)
2. Review `todo-app/test/frontend-static.test.js` to ensure the planned change won’t violate any static/safety constraints.

### Task 2 — Implement confirmation gating in `deleteTask(task)` (depends on Task 1)
**File:** `todo-app/public/app.js`
1. Update `deleteTask(task)` to:
   - return immediately if `busy` is true (keep current effective behavior via `mutate`, but make it explicit to avoid dialogs while disabled)
   - construct a confirmation message using plain strings (no HTML) and include `task.description`
   - call `window.confirm(message)`
     - if **Cancel/Dismiss**: return early **before** calling `mutate('DELETE', ...)`
     - if **Confirm**: proceed with existing flow
2. Ensure the cancel path makes **no** network call and does not:
   - clear the error region
   - change `editingId`
   - change focus (keep current focus where it is)

### Task 3 — Update/extend tests to cover regression (depends on Task 2)
**File:** `todo-app/test/frontend-static.test.js`
- Add a lightweight regression assertion that `public/app.js` contains a `confirm(` call.
  - This is not a behavior test, but it prevents accidental removal of the confirmation step.

### Task 4 — Manual verification steps (depends on Task 2)
Document (in this plan; optionally later in README) a short manual test checklist:
1. Create task “Buy milk”.
2. Click Delete -> Cancel.
   - Task remains visible
   - No error shown
3. Click Delete -> Confirm.
   - Task disappears after refresh
4. Create task with special chars: `<b>not html</b> & more`.
   - Confirmation prompt shows the characters literally.

### Task 5 — (Optional) README adjustment (depends on Task 2; SA to confirm)
**File:** `todo-app/README.md`
- Update the “Limitations” line about delete confirmation:
  - from “no confirmation” to “requires confirmation; no undo”.

## 7. Requirement-to-task traceability
| Requirement | Summary | Tasks |
|---|---|---|
| FR-DEL-001 | Prompt before delete API call | Task 2, Task 3, Task 4 |
| FR-DEL-002 | Delete only on confirm | Task 2, Task 4 |
| FR-DEL-003 | Cancel does nothing and no request | Task 2, Task 4 |
| NFR-DEL-001 | Prompt text treated as plain text | Task 2, Task 4 |

## 8. Frontend, backend, and database considerations
### Frontend
- Minimal, low-risk approach: browser-native `window.confirm`.
- Keep safe-rendering posture intact: prompt message is a string; existing DOM rendering already uses `textContent`.

### Backend
- No changes. Continue calling `DELETE /api/tasks/{id}`.

### Database
- No changes.

## 9. Proposed tests (Gherkin and Playwright coverage)
### 9.1 Gherkin (derived from requirement IDs)
```gherkin
Feature: Confirm before deleting a task

  Background:
    Given the Todo app is running
    And at least one task exists

  Scenario: Confirm deletion (FR-DEL-002)
    Given a task "Buy milk" is visible in the task list
    When the user clicks Delete for "Buy milk"
    Then the UI displays a confirmation prompt (FR-DEL-001)
    When the user confirms the prompt
    Then the app sends DELETE /api/tasks/{id} for "Buy milk"
    And "Buy milk" is no longer visible in the list

  Scenario: Cancel deletion (FR-DEL-003)
    Given a task "Buy milk" is visible in the task list
    When the user clicks Delete for "Buy milk"
    Then the UI displays a confirmation prompt (FR-DEL-001)
    When the user cancels the prompt
    Then no DELETE request is sent
    And "Buy milk" remains visible in the list

  Scenario: Prompt is plain text (NFR-DEL-001)
    Given a task "<b>not html</b> & more" is visible in the task list
    When the user clicks Delete for that task
    Then the confirmation prompt displays the characters literally
```

### 9.2 Playwright (coverage proposal; not implemented in this plan)
If the repo is allowed to add Playwright later, add an E2E spec that:
- hooks `page.on('dialog', ...)` to assert the dialog type is `confirm` and message contains the task description
- dismiss path verifies task remains and no DELETE is observed
- accept path verifies task is removed

## 10. Build, documentation, deployment, and rollback considerations
- **Build:** none (static frontend).
- **Tests:** `cd todo-app && npm test`.
- **Local run:** `cd todo-app && npm start`.
- **Rollback:** revert the single frontend change (and any related test/README changes) to restore previous behavior.

## 11. Risks, assumptions, and open questions
### Assumptions
- A native confirmation dialog (`window.confirm`) is acceptable UX for this capstone app.

### Risks
- Confirm dialog copy: long descriptions (up to 200 chars) may be verbose.
- Automated E2E: current repo does not show Playwright tooling; adding it may be considered scope creep.

### Open questions
- Should the confirmation text include the full description or a truncated version? (Analysis suggests truncation optional.)

## 12. Decisions requiring Solution Architect review
1. **Dialog approach:** keep `window.confirm` (recommended for smallest change) vs implement custom modal.
2. **README update:** whether to update the “Limitations” statement now (recommended) or leave as-is.
3. **Automated UI testing:** whether Playwright should be introduced to satisfy E2E coverage expectations.

## 13. Proposed GitHub branch and draft PR approach
- Create a feature branch **from** `story/todo-application-20261110065333-2618c391`.
- Keep changes small and reviewable: frontend change + minimal test + (optional) README.

## 14. Human approval status and handoff notes for Solution Architect
- This plan is based on:
  - verified local analysis at `todo-app/.sdlc/analysis.md`
  - verified Confluence story page **7634945**
- No implementation code has been written as part of this planning step.
- Awaiting SA feedback on §12 decisions before development begins.
